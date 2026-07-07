"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { STATUS_LABELS } from "@/lib/utils";
import type { TaskStatus } from "@/lib/types";

export type CommandItemType =
  | "project"
  | "engagement"
  | "task"
  | "prd"
  | "quote"
  | "contract"
  | "transcript";

/**
 * A single navigable result for the global command palette. `keywords` is a
 * lowercased blob (title + subtitle + deep content) the client filters against;
 * `href` is the destination the palette routes to on Enter/click.
 */
export interface CommandItem {
  id: string;
  type: CommandItemType;
  title: string;
  subtitle?: string;
  href: string;
  keywords: string;
}

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : await createClient();
}

/** Per-document cap on extracted body text folded into the keyword blob. */
const MAX_CONTENT_CHARS = 4000;

/** Map a document type to its route segment (quotes is the only plural). */
const DOC_PATH: Record<"prd" | "quote" | "contract", string> = {
  prd: "prd",
  quote: "quotes",
  contract: "contract",
};

const DOC_LABEL: Record<"prd" | "quote" | "contract", string> = {
  prd: "PRD",
  quote: "Quote",
  contract: "Contract",
};

/**
 * Recursively collect string *leaf values* from arbitrary JSONB content,
 * ignoring object keys and numeric/boolean leaves. Schema-agnostic so it keeps
 * working as PRD/quote/contract content shapes evolve.
 */
function flattenJsonText(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    const s = value.trim();
    if (s) out.push(s);
  } else if (Array.isArray(value)) {
    for (const v of value) flattenJsonText(v, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) flattenJsonText(v, out);
  }
}

function contentText(content: unknown): string {
  const out: string[] = [];
  flattenJsonText(content, out);
  return out.join(" ").slice(0, MAX_CONTENT_CHARS);
}

function buildKeywords(parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

interface TaskRow {
  id: string;
  title: string | null;
  description: string | null;
  status: string | null;
}

interface DocRow {
  id: string;
  title: string | null;
  project_id: string;
  content: unknown;
}

interface TranscriptRow {
  id: string;
  label: string | null;
  project_id: string;
  content: string | null;
}

function taskItem(t: TaskRow, basePath: "/b" | "/o"): CommandItem {
  return {
    id: t.id,
    type: "task",
    title: t.title ?? "Untitled task",
    subtitle: t.status ? STATUS_LABELS[t.status as TaskStatus] : undefined,
    href: `${basePath}/tasks/${t.id}`,
    keywords: buildKeywords([t.title, t.description, "task"]),
  };
}

/**
 * Builds the searchable index for a builder: their projects, engagements, tasks,
 * documents (PRD/quote/contract), and discovery transcripts. Ownership is
 * replicated explicitly on every query because the dev admin client bypasses RLS.
 */
async function builderIndex(supabase: SupabaseClient, ownerId: string): Promise<CommandItem[]> {
  const items: CommandItem[] = [];

  // Projects + engagements first — their ids scope the downstream queries.
  const [projectsRes, engagementsRes] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, status, context, prospect_name")
      .eq("owner_id", ownerId),
    supabase.from("engagements").select("id, title").eq("builder_id", ownerId),
  ]);

  const projects = (projectsRes.data ?? []) as {
    id: string;
    name: string | null;
    status: string | null;
    context: string | null;
    prospect_name: string | null;
  }[];
  const engagements = (engagementsRes.data ?? []) as { id: string; title: string | null }[];

  const projectIds = projects.map((p) => p.id);
  const engagementIds = engagements.map((e) => e.id);
  const projectName = new Map(projects.map((p) => [p.id, p.name ?? "Untitled project"]));

  for (const p of projects) {
    items.push({
      id: p.id,
      type: "project",
      title: p.name ?? "Untitled project",
      subtitle: p.status ?? undefined,
      href: `/b/projects/${p.id}`,
      keywords: buildKeywords([p.name, p.prospect_name, p.context, p.status, "project"]),
    });
  }

  for (const e of engagements) {
    items.push({
      id: e.id,
      type: "engagement",
      title: e.title ?? "Client",
      href: `/b/engagements/${e.id}`,
      keywords: buildKeywords([e.title, "client engagement"]),
    });
  }

  // Tasks across the builder's engagements (mirrors app/b/page.tsx filter), plus
  // the per-project documents and transcripts — all in parallel. Personal
  // (no-engagement) tasks are scoped to their creator: the dev admin client
  // bypasses RLS, so a bare engagement_id.is.null would surface every user's
  // personal tasks.
  const personalFilter = `and(engagement_id.is.null,created_by.eq.${ownerId})`;
  const taskFilter = engagementIds.length
    ? `engagement_id.in.(${engagementIds.join(",")}),${personalFilter}`
    : personalFilter;

  const docsPromise = projectIds.length
    ? Promise.all([
        supabase.from("prds").select("id, title, project_id, content").in("project_id", projectIds),
        supabase.from("quotes").select("id, title, project_id, content").in("project_id", projectIds),
        supabase
          .from("contracts")
          .select("id, title, project_id, content")
          .in("project_id", projectIds),
        supabase
          .from("project_sop_transcripts")
          .select("id, label, project_id, content")
          .in("project_id", projectIds),
      ])
    : Promise.resolve(null);

  const [tasksRes, docs] = await Promise.all([
    supabase.from("tasks").select("id, title, description, status").or(taskFilter),
    docsPromise,
  ]);

  for (const t of (tasksRes.data ?? []) as TaskRow[]) {
    items.push(taskItem(t, "/b"));
  }

  if (docs) {
    const [prdsRes, quotesRes, contractsRes, transcriptsRes] = docs;
    const docTypes: [("prd" | "quote" | "contract"), DocRow[]][] = [
      ["prd", (prdsRes.data ?? []) as DocRow[]],
      ["quote", (quotesRes.data ?? []) as DocRow[]],
      ["contract", (contractsRes.data ?? []) as DocRow[]],
    ];

    for (const [type, rows] of docTypes) {
      const label = DOC_LABEL[type];
      for (const d of rows) {
        const parent = projectName.get(d.project_id);
        items.push({
          id: d.id,
          type,
          title: d.title ?? `Untitled ${label}`,
          subtitle: parent ? `${label} · ${parent}` : label,
          href: `/b/projects/${d.project_id}/${DOC_PATH[type]}/${d.id}`,
          keywords: buildKeywords([d.title, label, parent, contentText(d.content)]),
        });
      }
    }

    for (const tr of (transcriptsRes.data ?? []) as TranscriptRow[]) {
      const parent = projectName.get(tr.project_id);
      items.push({
        id: tr.id,
        type: "transcript",
        title: tr.label ?? "Transcript",
        subtitle: parent ? `Transcript · ${parent}` : "Transcript",
        href: `/b/projects/${tr.project_id}`,
        keywords: buildKeywords([
          tr.label,
          "transcript",
          parent,
          (tr.content ?? "").slice(0, MAX_CONTENT_CHARS),
        ]),
      });
    }
  }

  return items;
}

/**
 * Builds the searchable index for an operator: only their engagement(s) and the
 * tasks within them. Operators never see builder-owned projects or documents.
 */
async function operatorIndex(supabase: SupabaseClient, operatorId: string): Promise<CommandItem[]> {
  const items: CommandItem[] = [];

  const { data: engData } = await supabase
    .from("engagements")
    .select("id, title")
    .eq("operator_id", operatorId);
  const engagements = (engData ?? []) as { id: string; title: string | null }[];
  const engagementIds = engagements.map((e) => e.id);

  for (const e of engagements) {
    // There is no /o/engagements/[id] route — operators land on the singular page.
    items.push({
      id: e.id,
      type: "engagement",
      title: e.title ?? "Builder",
      subtitle: "Builder",
      href: "/o/engagement",
      keywords: buildKeywords([e.title, "builder engagement profile"]),
    });
  }

  // Personal (no-engagement) tasks are scoped to their creator — the dev admin
  // client bypasses RLS, so a bare engagement_id.is.null would leak every user's
  // personal tasks into this operator's search index.
  const personalFilter = `and(engagement_id.is.null,created_by.eq.${operatorId})`;
  const taskFilter = engagementIds.length
    ? `engagement_id.in.(${engagementIds.join(",")}),${personalFilter}`
    : personalFilter;
  const { data: taskData } = await supabase
    .from("tasks")
    .select("id, title, description, status")
    .or(taskFilter);

  for (const t of (taskData ?? []) as TaskRow[]) {
    items.push(taskItem(t, "/o"));
  }

  return items;
}

/**
 * Role-scoped search index for the global command palette. Identity is resolved
 * server-side from cookies — the client never passes a role/id — so the result
 * set cannot be widened by a spoofed prop.
 */
export async function getCommandIndex(): Promise<CommandItem[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];

  const supabase = (await getClient(profile.id)) as SupabaseClient;
  return profile.role === "operator"
    ? operatorIndex(supabase, profile.id)
    : builderIndex(supabase, profile.id);
}
