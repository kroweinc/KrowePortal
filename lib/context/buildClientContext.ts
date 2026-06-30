import "server-only";

import { getCurrentProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { assertEngagementBuilder } from "@/lib/context/access";
import { getContextItems } from "@/lib/actions/context";
import { searchClientContext } from "@/lib/actions/context-search";
import { resolveRepoForGeneration } from "@/lib/github/resolve-repo";
import type { RepoContext } from "@/lib/github/types";
import type { ContextItem, TaskStatus } from "@/lib/types";

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
  repo: RepoContext | null;
  generatedAt: string;
}

// Protect the prompt from a pathological dump: cap aggregate full-text.
const FULL_TEXT_AGGREGATE_CAP = 60_000;

type TaskRow = {
  id: string;
  title: string;
  status: TaskStatus;
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
  opts?: { query?: string; k?: number; includeFullText?: boolean }
): Promise<ClientContextBundle> {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Unauthorized");
  if (profile.role !== "builder") throw new Error("Builder only.");
  if (!(await assertEngagementBuilder(engagementId, profile.id))) {
    throw new Error("Not your client.");
  }

  const admin = createAdminClient();

  // Engagement + business identity (same project join the detail page uses).
  const { data: eng } = await admin
    .from("engagements")
    .select(
      "id, title, started_at, github_repo_full_name, project:projects(name, prospect_name, website_url)"
    )
    .eq("id", engagementId)
    .eq("builder_id", profile.id)
    .maybeSingle();
  if (!eng) throw new Error("Engagement not found.");

  const project = Array.isArray(eng.project) ? eng.project[0] : eng.project;
  const engagement = {
    id: eng.id as string,
    title: (eng.title as string) ?? "Client",
    startedAt: (eng.started_at as string | null) ?? null,
    businessName: (project?.prospect_name as string | null) ?? (project?.name as string | null) ?? null,
    websiteUrl: (project?.website_url as string | null) ?? null,
  };

  // Context items (builder-only via getContextItems' own authorization).
  const rawItems = await getContextItems(engagementId);
  const items: ContextItemSummary[] = rawItems.map((it) => ({
    id: it.id,
    kind: it.kind,
    title: it.title,
    charCount: it.char_count,
    embeddingStatus: it.embedding_status,
    url: it.url,
    createdAt: it.created_at,
  }));

  // Mode branch.
  const mode: "full" | "query" = opts?.query?.trim() ? "query" : "full";
  let snippets: ContextSnippet[] | undefined;
  let itemTexts: ClientContextBundle["itemTexts"];

  if (mode === "query") {
    const { hits } = await searchClientContext(engagementId, opts!.query!, opts?.k ?? 8);
    snippets = (hits ?? []).map((h) => ({
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
  const { data: taskData } = await admin
    .from("tasks")
    .select("id, title, status, description, milestone:milestones(title)")
    .eq("engagement_id", engagementId)
    .order("created_at", { ascending: true });

  const open: BundleTask[] = [];
  const done: BundleTask[] = [];
  for (const row of (taskData ?? []) as TaskRow[]) {
    const task: BundleTask = {
      id: row.id,
      title: row.title,
      status: row.status,
      description: row.description,
      milestoneTitle: milestoneTitle(row.milestone),
    };
    if (row.status === "done") done.push(task);
    else open.push(task);
  }

  // Linked GitHub repo context (LLM-ready already).
  const { repoContext } = await resolveRepoForGeneration({ profileId: profile.id, engagementId });

  return {
    engagement,
    mode,
    query: opts?.query?.trim() || undefined,
    items,
    itemTexts,
    snippets,
    tasks: { open, done, counts: { open: open.length, done: done.length } },
    repo: repoContext,
    generatedAt: new Date().toISOString(),
  };
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

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
      lines.push(`- [${t.status}] ${t.title}${ms}`);
    }
  } else {
    lines.push("(none)");
  }
  lines.push("");

  // Knowledge
  if (bundle.mode === "query") {
    lines.push(`## Knowledge — top matches for "${bundle.query}"`);
    if (bundle.snippets?.length) {
      for (const s of bundle.snippets) {
        lines.push(`### ${s.itemTitle} (${s.itemKind}, similarity ${s.similarity.toFixed(2)})`);
        lines.push(truncate(s.content.trim(), 1500));
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
