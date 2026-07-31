import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import {
  updateTask,
  deleteTask,
  reorderTask,
  markTaskDone,
  markTaskForApproval,
  withdrawTaskApproval,
} from "@/lib/actions/tasks";
import { createSubtask, toggleSubtask } from "@/lib/actions/subtasks";
import { generateSubtasksForTask } from "@/lib/actions/ai-subtasks";
import { assignTaskStagingGroup, createStagingGroup } from "@/lib/actions/staging-groups";
import type { ToolDef } from "./tools";

// The task-action half of the context agent's tool registry. Every tool here is
// a thin, confirm-gated wrapper over an existing `"use server"` action in
// lib/actions/. Two rules hold throughout, mirroring create_task/
// update_task_status in tools.ts:
//   1. Scope is injected from the authorized run (ctx.engagementId) — never the
//      model. Title→id resolution is always scoped to that engagement.
//   2. The model addresses tasks by TITLE (the context lists no ids), so each
//      tool resolves the title within the engagement before mutating.
// These write tools execute in confirmToolCall's request scope, so the wrapped
// actions' getCurrentProfile()/RLS checks re-authorize as the builder.

// ── shared resolvers ──────────────────────────────────────────────────────
// The exact ilike + disambiguation logic update_task_status pioneered, lifted
// so every task tool resolves titles the same way. Each returns the match or a
// human message the tool hands straight back to the model.

export async function resolveTaskByTitle(
  engagementId: string,
  title: string
): Promise<{ task: { id: string; title: string } } | { error: string }> {
  const trimmed = title.trim();
  if (!trimmed) return { error: "A task title is required." };

  const admin = createAdminClient();
  const { data } = await admin
    .from("tasks")
    .select("id, title")
    .eq("engagement_id", engagementId)
    .ilike("title", `%${trimmed}%`)
    .limit(5);

  const matches = (data ?? []) as { id: string; title: string }[];
  if (matches.length === 0) return { error: `No task on this client matches "${trimmed}".` };
  if (matches.length > 1) {
    const exact = matches.filter((m) => m.title.toLowerCase() === trimmed.toLowerCase());
    if (exact.length !== 1) {
      return {
        error: `Several tasks match "${trimmed}" (${matches
          .map((m) => `"${m.title}"`)
          .join(", ")}). Ask which one.`,
      };
    }
    return { task: exact[0] };
  }
  return { task: matches[0] };
}

async function resolveStagingGroupByName(
  engagementId: string,
  name: string
): Promise<{ group: { id: string; name: string } } | { error: string }> {
  const trimmed = name.trim();
  if (!trimmed) return { error: "A staging group name is required." };

  const admin = createAdminClient();
  const { data } = await admin
    .from("staging_groups")
    .select("id, name")
    .eq("engagement_id", engagementId)
    .order("created_at", { ascending: true });

  const groups = (data ?? []) as { id: string; name: string }[];
  const exact = groups.find((g) => g.name.toLowerCase() === trimmed.toLowerCase());
  if (exact) return { group: exact };

  const partial = groups.filter((g) => g.name.toLowerCase().includes(trimmed.toLowerCase()));
  if (partial.length === 1) return { group: partial[0] };
  if (partial.length > 1) {
    return {
      error: `Several groups match "${trimmed}" (${partial
        .map((g) => `"${g.name}"`)
        .join(", ")}). Ask which one.`,
    };
  }
  const available = groups.length ? groups.map((g) => `"${g.name}"`).join(", ") : "none yet";
  return {
    error: `No staging group named "${trimmed}" (existing: ${available}). Propose create_staging_group first if it should be new.`,
  };
}

async function resolveSubtaskByTitle(
  taskId: string,
  title: string
): Promise<{ subtask: { id: string; title: string } } | { error: string }> {
  const trimmed = title.trim();
  if (!trimmed) return { error: "A subtask title is required." };

  const admin = createAdminClient();
  const { data } = await admin
    .from("task_subtasks")
    .select("id, title")
    .eq("task_id", taskId)
    .ilike("title", `%${trimmed}%`)
    .limit(5);

  const matches = (data ?? []) as { id: string; title: string }[];
  if (matches.length === 0) return { error: `No subtask matches "${trimmed}".` };
  if (matches.length > 1) {
    const exact = matches.filter((m) => m.title.toLowerCase() === trimmed.toLowerCase());
    if (exact.length !== 1) {
      return { error: `Several subtasks match "${trimmed}". Ask which one.` };
    }
    return { subtask: exact[0] };
  }
  return { subtask: matches[0] };
}

// ── write: edit_task ──────────────────────────────────────────────────────
const editTaskTool: ToolDef = {
  kind: "write",
  spec: {
    type: "function",
    function: {
      name: "edit_task",
      description:
        "Change fields on one of this client's existing tasks — its title, description, priority, type, or hour estimate. Reference the task by its current title. Only include the fields you want to change.",
      parameters: {
        type: "object",
        properties: {
          taskTitle: {
            type: "string",
            description: "The task's current title (or a distinctive part of it).",
          },
          title: { type: "string", description: "New title (optional)." },
          description: { type: "string", description: "New description (optional)." },
          priority: {
            type: "string",
            enum: ["low", "medium", "high", "urgent"],
            description: "New priority (optional).",
          },
          type: {
            type: "string",
            enum: ["feature", "bug", "change"],
            description: "New task type (optional).",
          },
          estimateHours: {
            type: "number",
            description: "New builder hour estimate (optional).",
          },
        },
        required: ["taskTitle"],
        additionalProperties: false,
      },
    },
  },
  async execute(args, ctx) {
    const taskTitle = typeof args.taskTitle === "string" ? args.taskTitle : "";
    const resolved = await resolveTaskByTitle(ctx.engagementId, taskTitle);
    if ("error" in resolved) return { content: resolved.error };

    const fd = new FormData();
    fd.set("id", resolved.task.id);
    let changed = 0;
    if (typeof args.title === "string" && args.title.trim()) {
      fd.set("title", args.title.trim());
      changed++;
    }
    if (typeof args.description === "string" && args.description.trim()) {
      fd.set("description", args.description.trim());
      changed++;
    }
    if (["low", "medium", "high", "urgent"].includes(String(args.priority))) {
      fd.set("priority", String(args.priority));
      changed++;
    }
    if (["feature", "bug", "change"].includes(String(args.type))) {
      fd.set("type", String(args.type));
      changed++;
    }
    if (typeof args.estimateHours === "number" && Number.isFinite(args.estimateHours)) {
      fd.set("builder_estimate_hours", String(args.estimateHours));
      changed++;
    }

    if (changed === 0) return { content: `No fields to change on "${resolved.task.title}".` };

    const res = await updateTask(fd);
    if (res && "error" in res && res.error) {
      return { content: `Couldn't update "${resolved.task.title}": ${res.error}` };
    }
    return { content: `Updated "${resolved.task.title}".` };
  },
};

// ── write: delete_task ────────────────────────────────────────────────────
const deleteTaskTool: ToolDef = {
  kind: "write",
  spec: {
    type: "function",
    function: {
      name: "delete_task",
      description:
        "Permanently delete one of this client's tasks. Reference it by title. Use only when the builder clearly wants the task removed — not merely moved or closed.",
      parameters: {
        type: "object",
        properties: {
          taskTitle: {
            type: "string",
            description: "The task's title (or a distinctive part of it).",
          },
        },
        required: ["taskTitle"],
        additionalProperties: false,
      },
    },
  },
  async execute(args, ctx) {
    const taskTitle = typeof args.taskTitle === "string" ? args.taskTitle : "";
    const resolved = await resolveTaskByTitle(ctx.engagementId, taskTitle);
    if ("error" in resolved) return { content: resolved.error };

    const res = await deleteTask(resolved.task.id);
    if (res && "error" in res && res.error) {
      return { content: `Couldn't delete "${resolved.task.title}": ${res.error}` };
    }
    return { content: `Deleted "${resolved.task.title}".` };
  },
};

// ── write: reorder_tasks ──────────────────────────────────────────────────
// Sets sort_order (ascending = top of the column) from the given title order.
// Resolves every title first so a bad match never leaves a half-applied order.
const reorderTasksTool: ToolDef = {
  kind: "write",
  spec: {
    type: "function",
    function: {
      name: "reorder_tasks",
      description:
        "Reorder, sort, prioritize, or rank this client's tasks. YOU compute the order and pass the task titles top-to-bottom — the first becomes the top of its column. Rank by whatever the builder asked for (importance/priority, urgency, dependencies, milestone); each task's priority is in the CLIENT CONTEXT. List every task you're ordering — tasks you omit keep their place. This is a proposal the builder confirms before it applies.",
      parameters: {
        type: "object",
        properties: {
          orderedTaskTitles: {
            type: "array",
            items: { type: "string" },
            description: "Task titles in the desired order, first = top.",
          },
        },
        required: ["orderedTaskTitles"],
        additionalProperties: false,
      },
    },
  },
  async execute(args, ctx) {
    const titles = Array.isArray(args.orderedTaskTitles)
      ? args.orderedTaskTitles.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      : [];
    if (titles.length === 0) return { content: "No tasks given to reorder." };

    const tasks: { id: string; title: string }[] = [];
    for (const t of titles) {
      const resolved = await resolveTaskByTitle(ctx.engagementId, t);
      if ("error" in resolved) return { content: resolved.error };
      tasks.push(resolved.task);
    }

    for (let i = 0; i < tasks.length; i++) {
      const res = await reorderTask(tasks[i].id, (i + 1) * 100);
      if (res && "error" in res && res.error) {
        return { content: `Couldn't reorder "${tasks[i].title}": ${res.error}` };
      }
    }
    return {
      content: `Reordered ${tasks.length} task${tasks.length === 1 ? "" : "s"}: ${tasks
        .map((t) => `"${t.title}"`)
        .join(" → ")}.`,
    };
  },
};

// ── write: mark_task_done ─────────────────────────────────────────────────
// The "done" transition update_task_status deliberately excludes. Goes through
// markTaskDone so completed_at is stamped and any pending approval resolves.
const markTaskDoneTool: ToolDef = {
  kind: "write",
  spec: {
    type: "function",
    function: {
      name: "mark_task_done",
      description:
        "Mark one of this client's tasks as done (shipped). Reference it by title. Add a short completion note on what was delivered. This closes the task and resolves any pending approval.",
      parameters: {
        type: "object",
        properties: {
          taskTitle: {
            type: "string",
            description: "The task's title (or a distinctive part of it).",
          },
          completionNote: {
            type: "string",
            description: "Short note on what was delivered (optional but preferred).",
          },
        },
        required: ["taskTitle"],
        additionalProperties: false,
      },
    },
  },
  async execute(args, ctx) {
    const taskTitle = typeof args.taskTitle === "string" ? args.taskTitle : "";
    const resolved = await resolveTaskByTitle(ctx.engagementId, taskTitle);
    if ("error" in resolved) return { content: resolved.error };

    const note = typeof args.completionNote === "string" ? args.completionNote.trim() : "";
    const res = await markTaskDone(resolved.task.id, {
      pushed_to_main: false,
      completion_note: note || null,
    });
    if (res && "error" in res && res.error) {
      return { content: `Couldn't mark "${resolved.task.title}" done: ${res.error}` };
    }
    return { content: `Marked "${resolved.task.title}" done.` };
  },
};

// ── write: send_task_for_approval ─────────────────────────────────────────
const sendForApprovalTool: ToolDef = {
  kind: "write",
  spec: {
    type: "function",
    function: {
      name: "send_task_for_approval",
      description:
        "Send one of this client's tasks to the operator for approval. Reference it by title. Optionally include a note on what to review. The task keeps its column and gains a 'Sent for approval' pill.",
      parameters: {
        type: "object",
        properties: {
          taskTitle: {
            type: "string",
            description: "The task's title (or a distinctive part of it).",
          },
          note: {
            type: "string",
            description: "Optional note for the operator on what to review.",
          },
        },
        required: ["taskTitle"],
        additionalProperties: false,
      },
    },
  },
  async execute(args, ctx) {
    const taskTitle = typeof args.taskTitle === "string" ? args.taskTitle : "";
    const resolved = await resolveTaskByTitle(ctx.engagementId, taskTitle);
    if ("error" in resolved) return { content: resolved.error };

    const note = typeof args.note === "string" ? args.note.trim() : "";
    const res = await markTaskForApproval(resolved.task.id, { note: note || null });
    if (res && "error" in res && res.error) {
      return { content: `Couldn't send "${resolved.task.title}" for approval: ${res.error}` };
    }
    return { content: `Sent "${resolved.task.title}" for approval.` };
  },
};

// ── write: withdraw_task_approval ─────────────────────────────────────────
const withdrawApprovalTool: ToolDef = {
  kind: "write",
  spec: {
    type: "function",
    function: {
      name: "withdraw_task_approval",
      description:
        "Pull one of this client's tasks back out of the approval queue (unsend). Reference it by title. Works only if it was sent but not yet approved.",
      parameters: {
        type: "object",
        properties: {
          taskTitle: {
            type: "string",
            description: "The task's title (or a distinctive part of it).",
          },
        },
        required: ["taskTitle"],
        additionalProperties: false,
      },
    },
  },
  async execute(args, ctx) {
    const taskTitle = typeof args.taskTitle === "string" ? args.taskTitle : "";
    const resolved = await resolveTaskByTitle(ctx.engagementId, taskTitle);
    if ("error" in resolved) return { content: resolved.error };

    const res = await withdrawTaskApproval(resolved.task.id);
    if (res && "error" in res && res.error) {
      return { content: `Couldn't withdraw "${resolved.task.title}": ${res.error}` };
    }
    return { content: `Withdrew "${resolved.task.title}" from approval.` };
  },
};

// ── write: add_subtask ────────────────────────────────────────────────────
const addSubtaskTool: ToolDef = {
  kind: "write",
  spec: {
    type: "function",
    function: {
      name: "add_subtask",
      description:
        "Add a checklist subtask to one of this client's tasks. Reference the parent task by title.",
      parameters: {
        type: "object",
        properties: {
          taskTitle: { type: "string", description: "The parent task's title." },
          subtaskTitle: { type: "string", description: "The subtask to add." },
        },
        required: ["taskTitle", "subtaskTitle"],
        additionalProperties: false,
      },
    },
  },
  async execute(args, ctx) {
    const taskTitle = typeof args.taskTitle === "string" ? args.taskTitle : "";
    const subtaskTitle = typeof args.subtaskTitle === "string" ? args.subtaskTitle.trim() : "";
    if (!subtaskTitle) return { content: "A subtask title is required." };

    const resolved = await resolveTaskByTitle(ctx.engagementId, taskTitle);
    if ("error" in resolved) return { content: resolved.error };

    const res = await createSubtask(resolved.task.id, subtaskTitle);
    if (res.error) return { content: `Couldn't add the subtask: ${res.error}` };
    return { content: `Added subtask "${subtaskTitle}" to "${resolved.task.title}".` };
  },
};

// ── write: toggle_subtask ─────────────────────────────────────────────────
const toggleSubtaskTool: ToolDef = {
  kind: "write",
  spec: {
    type: "function",
    function: {
      name: "toggle_subtask",
      description:
        "Check off or reopen a subtask on one of this client's tasks. Reference the parent task by title and the subtask by its text.",
      parameters: {
        type: "object",
        properties: {
          taskTitle: { type: "string", description: "The parent task's title." },
          subtaskTitle: {
            type: "string",
            description: "The subtask's text (or a distinctive part).",
          },
          completed: {
            type: "boolean",
            description: "true to check it off, false to reopen it.",
          },
        },
        required: ["taskTitle", "subtaskTitle", "completed"],
        additionalProperties: false,
      },
    },
  },
  async execute(args, ctx) {
    const taskTitle = typeof args.taskTitle === "string" ? args.taskTitle : "";
    const subtaskTitle = typeof args.subtaskTitle === "string" ? args.subtaskTitle : "";
    const completed = args.completed === true;

    const resolvedTask = await resolveTaskByTitle(ctx.engagementId, taskTitle);
    if ("error" in resolvedTask) return { content: resolvedTask.error };
    const resolvedSub = await resolveSubtaskByTitle(resolvedTask.task.id, subtaskTitle);
    if ("error" in resolvedSub) return { content: resolvedSub.error };

    const res = await toggleSubtask(resolvedSub.subtask.id, completed);
    if (res.error) return { content: `Couldn't update the subtask: ${res.error}` };
    return {
      content: `${completed ? "Checked off" : "Reopened"} "${resolvedSub.subtask.title}".`,
    };
  },
};

// ── write: generate_subtasks ──────────────────────────────────────────────
const generateSubtasksTool: ToolDef = {
  kind: "write",
  spec: {
    type: "function",
    function: {
      name: "generate_subtasks",
      description:
        "Use AI to break one of this client's tasks into a checklist of subtasks and append them. Reference the task by title. Propose this when the builder wants help planning a task's steps.",
      parameters: {
        type: "object",
        properties: {
          taskTitle: {
            type: "string",
            description: "The task's title (or a distinctive part of it).",
          },
        },
        required: ["taskTitle"],
        additionalProperties: false,
      },
    },
  },
  async execute(args, ctx) {
    const taskTitle = typeof args.taskTitle === "string" ? args.taskTitle : "";
    const resolved = await resolveTaskByTitle(ctx.engagementId, taskTitle);
    if ("error" in resolved) return { content: resolved.error };

    const res = await generateSubtasksForTask(resolved.task.id);
    if (res.error) return { content: `Couldn't generate subtasks: ${res.error}` };
    const n = res.inserted.length;
    if (n === 0) return { content: `No new subtasks were generated for "${resolved.task.title}".` };
    return { content: `Added ${n} subtask${n === 1 ? "" : "s"} to "${resolved.task.title}".` };
  },
};

// ── write: assign_staging_group ───────────────────────────────────────────
const assignStagingGroupTool: ToolDef = {
  kind: "write",
  spec: {
    type: "function",
    function: {
      name: "assign_staging_group",
      description:
        "File one of this client's tasks under a staging group (or clear it). Reference the task by title and the group by name. If the group doesn't exist yet, propose create_staging_group first.",
      parameters: {
        type: "object",
        properties: {
          taskTitle: {
            type: "string",
            description: "The task's title (or a distinctive part of it).",
          },
          groupName: {
            type: "string",
            description: "The staging group's name, or 'none' to clear the task's group.",
          },
        },
        required: ["taskTitle", "groupName"],
        additionalProperties: false,
      },
    },
  },
  async execute(args, ctx) {
    const taskTitle = typeof args.taskTitle === "string" ? args.taskTitle : "";
    const groupName = typeof args.groupName === "string" ? args.groupName.trim() : "";

    const resolvedTask = await resolveTaskByTitle(ctx.engagementId, taskTitle);
    if ("error" in resolvedTask) return { content: resolvedTask.error };

    if (!groupName || groupName.toLowerCase() === "none") {
      const res = await assignTaskStagingGroup(resolvedTask.task.id, null);
      if ("error" in res) return { content: `Couldn't clear the group: ${res.error}` };
      return { content: `Cleared the staging group on "${resolvedTask.task.title}".` };
    }

    const resolvedGroup = await resolveStagingGroupByName(ctx.engagementId, groupName);
    if ("error" in resolvedGroup) return { content: resolvedGroup.error };

    const res = await assignTaskStagingGroup(resolvedTask.task.id, resolvedGroup.group.id);
    if ("error" in res) return { content: `Couldn't file the task: ${res.error}` };
    return {
      content: `Filed "${resolvedTask.task.title}" under "${resolvedGroup.group.name}".`,
    };
  },
};

// ── write: create_staging_group ───────────────────────────────────────────
const createStagingGroupTool: ToolDef = {
  kind: "write",
  spec: {
    type: "function",
    function: {
      name: "create_staging_group",
      description:
        "Create a named staging group for this client so tasks can be filed under it on the staging board.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "The staging group's name (1–80 characters)." },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
  },
  async execute(args, ctx) {
    const name = typeof args.name === "string" ? args.name.trim() : "";
    if (!name) return { content: "A staging group name is required." };

    const res = await createStagingGroup(ctx.engagementId, name);
    if ("error" in res) return { content: `Couldn't create the group: ${res.error}` };
    return { content: `Created staging group "${res.group.name}".` };
  },
};

// ── read: list_staging_groups ─────────────────────────────────────────────
// Scoped by engagement via the admin client (not getStagingGroups, which needs
// request cookies the background turn engine doesn't have) — mirrors list_tasks.
const listStagingGroupsTool: ToolDef = {
  kind: "read",
  spec: {
    type: "function",
    function: {
      name: "list_staging_groups",
      description:
        "List this client's staging groups by name. Call this before filing a task so you use an exact existing group name.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  async execute(_args, ctx) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("staging_groups")
      .select("name")
      .eq("engagement_id", ctx.engagementId)
      .order("created_at", { ascending: true });

    const names = ((data ?? []) as { name: string }[]).map((g) => g.name);
    if (names.length === 0) return { content: "This client has no staging groups yet." };
    return { content: `Staging groups: ${names.map((n) => `"${n}"`).join(", ")}.` };
  },
};

// The task-action tools, spread into the main registry in tools.ts.
export const TASK_TOOLS: Record<string, ToolDef> = {
  edit_task: editTaskTool,
  delete_task: deleteTaskTool,
  reorder_tasks: reorderTasksTool,
  mark_task_done: markTaskDoneTool,
  send_task_for_approval: sendForApprovalTool,
  withdraw_task_approval: withdrawApprovalTool,
  add_subtask: addSubtaskTool,
  toggle_subtask: toggleSubtaskTool,
  generate_subtasks: generateSubtasksTool,
  assign_staging_group: assignStagingGroupTool,
  create_staging_group: createStagingGroupTool,
  list_staging_groups: listStagingGroupsTool,
};
