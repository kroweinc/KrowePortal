import "server-only";

import type OpenAI from "openai";
import { searchClientContext } from "@/lib/actions/context-search";
import { createTask, updateTaskStatus } from "@/lib/actions/tasks";
import { createAdminClient } from "@/lib/supabase/server";
import { STATUS_LABELS } from "@/lib/utils";
import type { Profile, TaskPriority, TaskStatus, TaskType } from "@/lib/types";
import type { AgentSource, AgentTasksWidget, AgentWidget, AgentWidgetTask } from "./types";
import type { DocEditEvent } from "./doc-events";
import { TASK_TOOLS, resolveTaskByTitle } from "./task-tools";
import { DOC_TOOLS } from "./doc-tools";

// Tool registry for the context agent. Each tool declares its OpenAI
// function-calling spec, whether it is a `read` tool (auto-runs inside the turn
// loop) or a `write` tool (proposed to the builder and executed only on
// confirmation), and an executor. The executor re-authorizes through the seam
// it calls (never trusts the model's scope).

export interface ToolContext {
  engagementId: string;
  builderId: string;
  /**
   * The project the builder is viewing, when the turn was fired from a
   * document/project page (`/b/projects/[id]/...`). The document tools scope to
   * it so they can reach docs under an ORPHAN project — a draft PRD whose project
   * no engagement links to yet — which the engagement→project path can't find.
   * Injected from the run/turn (never the model); falls back to the engagement's
   * linked project when unset.
   */
  projectId?: string;
  /**
   * Pre-authorized builder profile. Threaded in so read tools re-auth off it
   * instead of getCurrentProfile()/cookies() — the turn engine runs in a
   * background task (Next `after()`) where request-scoped cookies aren't
   * available. Optional: request-scoped callers (confirmToolCall's write tools)
   * don't need it and don't set it.
   */
  profile?: Profile;
}

export interface ToolResult {
  /** Text fed back to the model as the tool result. */
  content: string;
  /** Retrieved snippets to surface + persist as the assistant's Sources. */
  sources?: AgentSource[];
  /** Rendered UI to attach to the answer (e.g. a task board). */
  widget?: AgentWidget;
  /** The freshly-persisted document, for a write tool that edited one — carried
      back through confirmToolCall so the open doc view can reflect it live. */
  docEdit?: DocEditEvent;
}

export type ToolKind = "read" | "write";

export interface ToolDef {
  kind: ToolKind;
  spec: OpenAI.Chat.Completions.ChatCompletionTool;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

// ── read: search_context ──────────────────────────────────────────────────
// Reuses the production hybrid-retrieval seam (searchClientContext), which
// itself enforces builder ownership. Lets the agent dig deeper mid-conversation
// when the seeded context is thin.
const searchContext: ToolDef = {
  kind: "read",
  spec: {
    type: "function",
    function: {
      name: "search_context",
      description:
        "Search this client's context layer (documents, SOPs, transcripts, notes, tasks, codebase) for snippets relevant to a query. Use when the provided CLIENT CONTEXT is thin for the question before answering.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "What to look for, in natural language.",
          },
          k: {
            type: "integer",
            description: "Max snippets to return (optional; defaults to an adaptive value).",
            minimum: 1,
            maximum: 40,
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  async execute(args, ctx) {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) return { content: "No query provided." };
    const k = typeof args.k === "number" && Number.isFinite(args.k) ? args.k : undefined;

    const { hits, error } = await searchClientContext(
      ctx.engagementId,
      query,
      k,
      ctx.profile ? { profile: ctx.profile } : undefined
    );
    if (error) return { content: `Search failed: ${error}` };
    if (!hits || hits.length === 0) return { content: `No matches for "${query}".` };

    const sources: AgentSource[] = hits.map((h) => ({
      title: h.item.title,
      kind: h.item.kind,
      similarity: h.similarity,
    }));
    const rendered = hits
      .map(
        (h, i) =>
          `[${i + 1}] ${h.item.title} (${h.item.kind}, sim ${h.similarity.toFixed(2)})\n${h.content
            .trim()
            .slice(0, 1200)}`
      )
      .join("\n\n");
    return { content: rendered, sources };
  },
};

// ── read: list_tasks ──────────────────────────────────────────────────────
// Returns this client's tasks as a rendered, status-grouped board (a widget)
// instead of a flat markdown list. Scoped to the run's engagement (never the
// model's scope) — mirrors update_task_status's admin+engagement pattern.
// Board order is active-first, done-last; empty groups are dropped.
const TASK_STATUSES: TaskStatus[] = ["backlog", "todo", "in_progress", "done"];
const TASK_PRIORITIES: TaskPriority[] = ["low", "medium", "high", "urgent"];
// Active-first, done-last — the order the board renders its sections in.
const BOARD_ORDER: TaskStatus[] = ["in_progress", "todo", "backlog", "done"];

type ListTaskRow = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority | null;
  type: TaskType | null;
  milestone: { title: string | null } | { title: string | null }[] | null;
};

function rowMilestoneTitle(m: ListTaskRow["milestone"]): string | null {
  if (!m) return null;
  const one = Array.isArray(m) ? m[0] : m;
  return one?.title ?? null;
}

const listTasksTool: ToolDef = {
  kind: "read",
  spec: {
    type: "function",
    function: {
      name: "list_tasks",
      description:
        "Show this client's tasks as a visual board. Call this whenever the builder asks to see, list, or review tasks — all of them, or a subset by status or priority. The board renders the tasks for the builder, so keep your own reply to a one-line lead.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["backlog", "todo", "in_progress", "done", "open", "all"],
            description:
              "Filter by status. 'open' = everything not done; 'all' (default) = every task.",
          },
          priority: {
            type: "string",
            enum: ["low", "medium", "high", "urgent"],
            description: "Optional — only tasks at this priority.",
          },
          search: {
            type: "string",
            description: "Optional — only tasks whose title contains this text.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  async execute(args, ctx) {
    const statusArg = typeof args.status === "string" ? args.status : "all";
    const priorityArg =
      typeof args.priority === "string" && TASK_PRIORITIES.includes(args.priority as TaskPriority)
        ? (args.priority as TaskPriority)
        : null;
    const search = typeof args.search === "string" ? args.search.trim() : "";

    const admin = createAdminClient();
    let q = admin
      .from("tasks")
      .select("id, title, status, priority, type, milestone:milestones(title)")
      .eq("engagement_id", ctx.engagementId)
      .order("created_at", { ascending: true });

    if (statusArg === "open") q = q.neq("status", "done");
    else if (TASK_STATUSES.includes(statusArg as TaskStatus)) q = q.eq("status", statusArg);
    if (priorityArg) q = q.eq("priority", priorityArg);
    if (search) q = q.ilike("title", `%${search}%`);

    const { data, error } = await q;
    if (error) return { content: `Couldn't load tasks: ${error.message}` };

    const rows = (data ?? []) as ListTaskRow[];
    if (rows.length === 0) {
      const scope =
        statusArg === "all" || statusArg === "open" ? "" : ` ${STATUS_LABELS[statusArg as TaskStatus] ?? statusArg}`;
      return { content: `This client has no${scope} tasks${search ? ` matching "${search}"` : ""}.` };
    }

    // Group into the board's sections, active-first.
    const byStatus = new Map<TaskStatus, AgentWidgetTask[]>();
    for (const r of rows) {
      const task: AgentWidgetTask = {
        id: r.id,
        title: r.title,
        priority: (r.priority ?? "medium") as TaskPriority,
        type: r.type,
        milestoneTitle: rowMilestoneTitle(r.milestone),
      };
      const bucket = byStatus.get(r.status) ?? [];
      bucket.push(task);
      byStatus.set(r.status, bucket);
    }
    const groups = BOARD_ORDER.filter((s) => byStatus.get(s)?.length).map((status) => ({
      status,
      tasks: byStatus.get(status)!,
    }));

    const widget: AgentTasksWidget = { type: "tasks", groups };

    // What the model reads: a terse count so it writes a one-line lead, not a list.
    const summary = groups.map((g) => `${g.tasks.length} ${STATUS_LABELS[g.status]}`).join(", ");
    const filters = [
      priorityArg ? `${priorityArg} priority` : "",
      search ? `matching "${search}"` : "",
    ]
      .filter(Boolean)
      .join(", ");
    return {
      content: `Rendered a task board for the builder (${rows.length} task${
        rows.length === 1 ? "" : "s"
      }${filters ? `, ${filters}` : ""}: ${summary}). The board shows the detail — reply with a one-line lead, not a list.`,
      widget,
    };
  },
};

// ── write: create_task ────────────────────────────────────────────────────
// Confirm-gated. The engagement is injected from the authorized run context —
// never from the model — so the agent can only create tasks for the client the
// builder is actually talking about.
const createTaskTool: ToolDef = {
  kind: "write",
  spec: {
    type: "function",
    function: {
      name: "create_task",
      description:
        "Create a new task for this client. Propose this when the builder asks to add or track work. Draft a clear, specific title and an actionable description.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short, specific task title." },
          description: {
            type: "string",
            description: "What the task involves and why (optional but preferred).",
          },
          priority: {
            type: "string",
            enum: ["low", "medium", "high", "urgent"],
            description: "Optional; defaults to medium.",
          },
        },
        required: ["title"],
        additionalProperties: false,
      },
    },
  },
  async execute(args, ctx) {
    const title = typeof args.title === "string" ? args.title.trim() : "";
    if (!title) return { content: "Task not created: a title is required." };
    const description = typeof args.description === "string" ? args.description.trim() : "";
    const priority = ["low", "medium", "high", "urgent"].includes(String(args.priority))
      ? String(args.priority)
      : "medium";

    const fd = new FormData();
    fd.set("engagement_id", ctx.engagementId);
    fd.set("title", title);
    if (description) fd.set("description", description);
    fd.set("priority", priority);
    fd.set("confirm_duplicate", "true"); // the builder already reviewed this proposal

    const res = await createTask(fd);
    if (res && "error" in res && res.error) return { content: `Couldn't create the task: ${res.error}` };
    return { content: `Created task "${title}".` };
  },
};

// ── write: update_task_status ─────────────────────────────────────────────
// The serialized context lists tasks by TITLE (no ids), so the tool resolves a
// title to a task within the run's engagement — the model never handles ids,
// and can't move a task outside this client. "done" is excluded so the approval
// gate is never bypassed.
const updateTaskStatusTool: ToolDef = {
  kind: "write",
  spec: {
    type: "function",
    function: {
      name: "update_task_status",
      description:
        "Move one of this client's existing tasks to a new status. Reference the task by its title (as shown in the client context). Cannot mark tasks done — that goes through the approval flow.",
      parameters: {
        type: "object",
        properties: {
          taskTitle: {
            type: "string",
            description: "The task's title (or a distinctive part of it) from the client context.",
          },
          status: {
            type: "string",
            enum: ["backlog", "todo", "in_progress"],
            description: "The new status.",
          },
        },
        required: ["taskTitle", "status"],
        additionalProperties: false,
      },
    },
  },
  async execute(args, ctx) {
    const taskTitle = typeof args.taskTitle === "string" ? args.taskTitle.trim() : "";
    const status = String(args.status);
    if (!taskTitle || !["backlog", "todo", "in_progress"].includes(status)) {
      return { content: "Task not updated: a task title and a valid status are required." };
    }

    // Resolve the title to a task within THIS engagement (authorized run scope).
    const resolved = await resolveTaskByTitle(ctx.engagementId, taskTitle);
    if ("error" in resolved) return { content: resolved.error };

    const res = await updateTaskStatus(resolved.task.id, status as TaskStatus);
    if (res && "error" in res && res.error) return { content: `Couldn't update the task: ${res.error}` };
    return { content: `Moved "${resolved.task.title}" to ${status.replace("_", " ")}.` };
  },
};

// The live registry.
export const TOOLS: Record<string, ToolDef> = {
  search_context: searchContext,
  list_tasks: listTasksTool,
  create_task: createTaskTool,
  update_task_status: updateTaskStatusTool,
  ...TASK_TOOLS,
  ...DOC_TOOLS,
};

export function toolSpecs(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return Object.values(TOOLS).map((t) => t.spec);
}

export function getTool(name: string): ToolDef | undefined {
  return TOOLS[name];
}

export function isWriteTool(name: string): boolean {
  return TOOLS[name]?.kind === "write";
}
