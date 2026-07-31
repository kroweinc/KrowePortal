import "server-only";

import { getCurrentProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { assertEngagementBuilder } from "@/lib/context/access";
import { getContextItems } from "@/lib/actions/context";
import { searchClientContext } from "@/lib/actions/context-search";
import {
  getEngagementTimeline,
  type EngagementAnalytics,
  type EntityLifecycle,
} from "@/lib/context/lifecycle-analytics";
import { resolveRepoForGeneration } from "@/lib/github/resolve-repo";
import type { RepoContext } from "@/lib/github/types";
import type { ContextItem, Profile, TaskPriority, TaskStatus } from "@/lib/types";

// ============================================================
// The Client Context Layer's LLM/agent-ready interface. Every future feature
// that needs to reason over a client calls buildClientContext() to get one
// structured bundle, and serializeForPrompt() to render it for a model. Keep
// this the single seam so prompt shape evolves in one place.
// ============================================================

export interface ContextItemSummary {
  id: string;
  kind: ContextItem["kind"];
  title: string;
  charCount: number | null;
  embeddingStatus: ContextItem["embedding_status"];
  url: string | null;
  createdAt: string;
}

export interface ContextSnippet {
  itemId: string;
  itemTitle: string;
  itemKind: string;
  chunkIndex: number;
  similarity: number;
  content: string;
}

export interface BundleTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority | null;
  description: string | null;
  milestoneTitle: string | null;
}

export interface ClientContextBundle {
  engagement: {
    id: string;
    title: string;
    startedAt: string | null;
    businessName: string | null;
    websiteUrl: string | null;
  };
  mode: "full" | "query";
  query?: string;
  items: ContextItemSummary[];
  // full mode (when includeFullText): the items' extracted text, char-capped.
  itemTexts?: { id: string; title: string; kind: string; content: string }[];
  // query mode: the top-k semantically matched snippets.
  snippets?: ContextSnippet[];
  tasks: { open: BundleTask[]; done: BundleTask[]; counts: { open: number; done: number } };
  // The builder↔client interaction story: every document/task/relationship stage
  // transition with the time between each, plus engagement-level rollups.
  activity?: { lifecycles: EntityLifecycle[]; analytics: EngagementAnalytics };
  repo: RepoContext | null;
  generatedAt: string;
}

// Protect the prompt from a pathological dump: cap aggregate full-text.
const FULL_TEXT_AGGREGATE_CAP = 120_000;

type TaskRow = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority | null;
  description: string | null;
  milestone: { title: string | null } | { title: string | null }[] | null;
};

function milestoneTitle(milestone: TaskRow["milestone"]): string | null {
  if (!milestone) return null;
  const m = Array.isArray(milestone) ? milestone[0] : milestone;
  return m?.title ?? null;
}

/**
 * Assemble everything known about a client (engagement) into one bundle:
 * curated context items, tasks (+ milestone grouping), and the linked GitHub
 * repo. Builder-only — throws if the caller doesn't own the engagement.
 *
 * - query mode (opts.query set): items are surfaced as top-k semantic snippets.
 *   Cheap and scoped — the default for agent calls.
 * - full mode (no query): item summaries only, plus capped full text when
 *   opts.includeFullText is set.
 */
export async function buildClientContext(
  engagementId: string,
  opts?: { query?: string; k?: number; includeFullText?: boolean; includeActivity?: boolean },
  auth?: { profile: Profile }
): Promise<ClientContextBundle> {
  // The caller may pre-authorize (the agent route already gated the turn) to skip
  // a redundant round trip. Ownership is still enforced below: the engagement
  // select is scoped to builder_id, so a mismatched profile can't read a client.
  const profile = auth?.profile ?? (await getCurrentProfile());
  if (!profile) throw new Error("Unauthorized");
  if (profile.role !== "builder") throw new Error("Builder only.");
  if (!auth && !(await assertEngagementBuilder(engagementId, profile.id))) {
    throw new Error("Not your client.");
  }

  const admin = createAdminClient();
  const mode: "full" | "query" = opts?.query?.trim() ? "query" : "full";

  // Fan out every independent read at once. These previously ran as ~6 sequential
  // round trips (engagement → items → search → tasks → repo → timeline); the
  // retrieval embed + hybrid RPC is the long pole, so tasks/repo/timeline/items
  // now overlap under it instead of adding to it. Grounding wall-clock — the
  // dominant slice of the agent's time-to-first-token — drops toward the slowest
  // single read. `profile` is threaded into the search so it doesn't re-auth or
  // re-check the AI budget the route already cleared.
  const [engRes, rawItems, taskRes, repo, timeline, search] = await Promise.all([
    admin
      .from("engagements")
      .select(
        "id, title, started_at, github_repo_full_name, project:projects(name, prospect_name, website_url)"
      )
      .eq("id", engagementId)
      .eq("builder_id", profile.id)
      .maybeSingle(),
    getContextItems(engagementId),
    admin
      .from("tasks")
      .select("id, title, status, priority, description, milestone:milestones(title)")
      .eq("engagement_id", engagementId)
      .order("created_at", { ascending: true }),
    resolveRepoForGeneration({ profileId: profile.id, engagementId }),
    opts?.includeActivity !== false ? getEngagementTimeline(engagementId) : Promise.resolve(null),
    mode === "query"
      ? // k omitted → searchClientContext picks an adaptive top-k scaled to corpus size.
        searchClientContext(engagementId, opts!.query!, opts?.k, { profile })
      : Promise.resolve(null),
  ]);

  const eng = engRes.data;
  if (!eng) throw new Error("Engagement not found.");

  const project = Array.isArray(eng.project) ? eng.project[0] : eng.project;
  const engagement = {
    id: eng.id as string,
    title: (eng.title as string) ?? "Client",
    startedAt: (eng.started_at as string | null) ?? null,
    businessName: (project?.prospect_name as string | null) ?? (project?.name as string | null) ?? null,
    websiteUrl: (project?.website_url as string | null) ?? null,
  };

  const items: ContextItemSummary[] = rawItems.map((it) => ({
    id: it.id,
    kind: it.kind,
    title: it.title,
    charCount: it.char_count,
    embeddingStatus: it.embedding_status,
    url: it.url,
    createdAt: it.created_at,
  }));

  // Mode branch — shape the fanned-out search / full-text into the bundle.
  let snippets: ContextSnippet[] | undefined;
  let itemTexts: ClientContextBundle["itemTexts"];

  if (mode === "query") {
    snippets = (search?.hits ?? []).map((h) => ({
      itemId: h.contextItemId,
      itemTitle: h.item.title,
      itemKind: h.item.kind,
      chunkIndex: h.chunkIndex,
      similarity: h.similarity,
      content: h.content,
    }));
  } else if (opts?.includeFullText) {
    let budget = FULL_TEXT_AGGREGATE_CAP;
    itemTexts = [];
    for (const it of rawItems) {
      if (!it.content || budget <= 0) continue;
      const slice = it.content.slice(0, budget);
      budget -= slice.length;
      itemTexts.push({ id: it.id, title: it.title, kind: it.kind, content: slice });
    }
  }

  // Tasks (+ milestone grouping), split open/done like the detail page's counter.
  const open: BundleTask[] = [];
  const done: BundleTask[] = [];
  for (const row of (taskRes.data ?? []) as TaskRow[]) {
    const task: BundleTask = {
      id: row.id,
      title: row.title,
      status: row.status,
      priority: row.priority,
      description: row.description,
      milestoneTitle: milestoneTitle(row.milestone),
    };
    if (row.status === "done") done.push(task);
    else open.push(task);
  }

  const repoContext = repo.repoContext;

  // Interaction timeline + timing analytics (on by default; skip for the leanest
  // query-mode agent calls via opts.includeActivity === false).
  const activity: ClientContextBundle["activity"] = timeline
    ? { lifecycles: timeline.lifecycles, analytics: timeline.analytics }
    : undefined;

  return {
    engagement,
    mode,
    query: opts?.query?.trim() || undefined,
    items,
    itemTexts,
    snippets,
    tasks: { open, done, counts: { open: open.length, done: done.length } },
    activity,
    repo: repoContext,
    generatedAt: new Date().toISOString(),
  };
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// How an entity is headed in the interaction timeline.
function timelineHead(lc: EntityLifecycle): string {
  if (lc.kind === "relationship") return `[Engagement] ${lc.entityLabel}`;
  if (lc.kind === "task") return `[Task] ${lc.entityLabel}`;
  const map: Record<string, string> = {
    prd: "PRD",
    quote: "Quote",
    contract: "Contract",
    brief: "Brief",
    change_order: "Change Order",
  };
  return `[${(lc.docKind && map[lc.docKind]) || "Doc"}] ${lc.entityLabel}`;
}

// "(role · Name)" actor suffix for a timeline stage, empty when unknown.
function stageActor(role: string | null, name: string | null): string {
  if (!role) return "";
  return ` (${role}${name ? ` · ${name}` : ""})`;
}

// Bounds so a long-running engagement can't blow the prompt.
const TIMELINE_MAX_ENTITIES = 20;
const TIMELINE_MAX_STAGES = 8;
const TIMELINE_MAX_LINES = 220;

/**
 * Render a bundle to a single deterministic, bounded string an LLM reads. This
 * is the text seam future agents consume; keep sections stable.
 */
export function serializeForPrompt(bundle: ClientContextBundle): string {
  const { engagement: e, tasks, repo } = bundle;
  const lines: string[] = [];

  lines.push(`# CLIENT CONTEXT — ${e.title}`);
  if (e.businessName) lines.push(`Business: ${e.businessName}${e.websiteUrl ? ` (${e.websiteUrl})` : ""}`);
  if (e.startedAt) lines.push(`Engagement started: ${e.startedAt.slice(0, 10)}`);
  lines.push("");

  // Tasks
  lines.push(`## Tasks (${tasks.counts.open} open / ${tasks.counts.done} done)`);
  if (tasks.open.length || tasks.done.length) {
    for (const t of [...tasks.open, ...tasks.done]) {
      const ms = t.milestoneTitle ? ` — milestone: ${t.milestoneTitle}` : "";
      lines.push(`- [${t.status}] (${t.priority ?? "medium"} priority) ${t.title}${ms}`);
    }
  } else {
    lines.push("(none)");
  }
  lines.push("");

  // Engagement analytics + interaction timeline — the builder↔client story with
  // the time between each stage. This is the section future agents read to reason
  // about momentum, responsiveness, and where each artifact stands.
  if (bundle.activity) {
    const { analytics: a, lifecycles } = bundle.activity;

    lines.push("## Engagement Analytics");
    if (a.lastActivityLabel) {
      lines.push(
        `Last activity: ${a.lastActivityLabel}${a.lastActivityAt ? ` (${a.lastActivityAt.slice(0, 10)})` : ""}`
      );
    }
    lines.push(
      `Documents: ${a.docsSent} sent, ${a.docsSigned} signed` +
        (a.avgTimeToSignLabel ? ` · avg time to sign ${a.avgTimeToSignLabel}` : "") +
        (a.fastestSignLabel ? ` (fastest ${a.fastestSignLabel})` : "")
    );
    if (a.responseCadenceLabel) lines.push(`Client response cadence: ~${a.responseCadenceLabel}`);
    lines.push(
      `Tasks: ${a.tasksCompleted} completed` +
        (a.avgTaskCycleLabel ? ` · avg cycle ${a.avgTaskCycleLabel}` : "")
    );
    lines.push("");

    lines.push("## Interaction Timeline");
    if (lifecycles.length) {
      const ordered = [...lifecycles]
        .sort((x, y) => (x.lastActivityAt < y.lastActivityAt ? 1 : -1))
        .slice(0, TIMELINE_MAX_ENTITIES);
      let count = 0;
      let truncated = false;
      for (const lc of ordered) {
        if (count >= TIMELINE_MAX_LINES) {
          truncated = true;
          break;
        }
        lines.push(timelineHead(lc));
        count++;
        const omitted = Math.max(0, lc.stages.length - TIMELINE_MAX_STAGES);
        if (omitted > 0) {
          lines.push(`  …(${omitted} earlier ${omitted === 1 ? "stage" : "stages"} omitted)`);
          count++;
        }
        for (const s of lc.stages.slice(-TIMELINE_MAX_STAGES)) {
          const gap = s.sincePreviousLabel ? `  (+${s.sincePreviousLabel})` : "";
          const det = s.detail ? ` — "${truncate(s.detail, 160)}"` : "";
          lines.push(
            `  - ${s.stage}${stageActor(s.actorRole, s.actorName)} ${s.at.slice(0, 10)}${gap}${det}`
          );
          count++;
        }
        if (lc.totalElapsedLabel && lc.stages.length > 1) {
          lines.push(`  total: ${lc.totalElapsedLabel}`);
          count++;
        }
      }
      if (truncated || ordered.length < lifecycles.length) {
        lines.push("…(timeline truncated)");
      }
    } else {
      lines.push("(no interactions yet)");
    }
    lines.push("");
  }

  // Knowledge
  if (bundle.mode === "query") {
    lines.push(`## Knowledge — top matches for "${bundle.query}"`);
    if (bundle.snippets?.length) {
      for (const s of bundle.snippets) {
        lines.push(`### ${s.itemTitle} (${s.itemKind}, similarity ${s.similarity.toFixed(2)})`);
        lines.push(truncate(s.content.trim(), 2500));
        lines.push("");
      }
    } else {
      lines.push("(no matches)");
      lines.push("");
    }
  } else {
    lines.push(`## Knowledge (${bundle.items.length} items)`);
    const texts = new Map((bundle.itemTexts ?? []).map((t) => [t.id, t.content]));
    for (const it of bundle.items) {
      const ref = it.url ? ` — ${it.url}` : "";
      lines.push(`### ${it.title} (${it.kind})${ref}`);
      const body = texts.get(it.id);
      if (body) lines.push(truncate(body.trim(), 4000));
      lines.push("");
    }
    if (!bundle.items.length) lines.push("(none)\n");
  }

  // Codebase
  if (repo) {
    lines.push(`## Codebase — ${repo.fullName} (default ${repo.defaultBranch})`);
    if (repo.description) lines.push(repo.description);
    if (repo.languages.length) {
      lines.push("Languages: " + repo.languages.map((l) => `${l.name} ${l.pct}%`).join(", "));
    }
    if (repo.topLevelTree.length) lines.push("Structure: " + repo.topLevelTree.join(", "));
    if (repo.readmeExcerpt) {
      lines.push("README (excerpt):");
      lines.push(truncate(repo.readmeExcerpt.trim(), 2000));
    }
    if (repo.recentCommits.length) {
      lines.push("Recent commits:");
      for (const c of repo.recentCommits.slice(0, 10)) {
        lines.push(`- ${c.sha.slice(0, 7)} ${truncate(c.message.split("\n")[0], 100)} (${c.date.slice(0, 10)})`);
      }
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}
