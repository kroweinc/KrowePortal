import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import type { DraftPrdInput } from "@/lib/prd/draft-core";
import type {
  ActiveRun,
  AgentMessage,
  AgentMessageRole,
  AgentPhase,
  AgentRun,
  AgentRunStatus,
  AgentSource,
  AgentToolCall,
  AgentToolStatus,
  AgentWidget,
} from "./types";

// Data-access helpers for agent_runs / agent_messages (migration 0076). These
// go through the admin client and DO NOT authorize — every caller (the server
// actions in lib/actions/agent.ts and the SSE route) must first verify the
// builder owns the run's engagement via assertEngagementBuilder. Kept out of a
// "use server" file so they're never exposed as RPC endpoints.

type RunRow = {
  id: string;
  kind: string | null;
  engagement_id: string | null;
  project_id: string | null;
  prd_id: string | null;
  prd_input: DraftPrdInput | null;
  page: string | null;
  viewed_doc: { kind: string; id: string } | null;
  builder_id: string;
  title: string;
  status: string;
  phase: string | null;
  last_event_at: string | null;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  run_id: string;
  role: string;
  content: string;
  tool_calls: AgentToolCall[] | null;
  tool_call_id: string | null;
  tool_status: string | null;
  sources: AgentSource[] | null;
  widgets: AgentWidget[] | null;
  created_at: string;
};

function toRun(r: RunRow): AgentRun {
  return {
    id: r.id,
    kind: (r.kind as "chat" | "prd" | null) ?? "chat",
    engagementId: r.engagement_id,
    projectId: r.project_id,
    prdId: r.prd_id,
    builderId: r.builder_id,
    prdInput: r.prd_input,
    page: r.page ?? null,
    viewedDoc:
      r.viewed_doc && typeof r.viewed_doc === "object" && r.viewed_doc.kind && r.viewed_doc.id
        ? { kind: r.viewed_doc.kind as "prd" | "quote" | "contract", id: r.viewed_doc.id }
        : null,
    title: r.title,
    status: r.status as AgentRunStatus,
    phase: (r.phase as AgentPhase | null) ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toMessage(r: MessageRow): AgentMessage {
  return {
    id: r.id,
    runId: r.run_id,
    role: r.role as AgentMessageRole,
    content: r.content,
    toolCalls: r.tool_calls ?? null,
    toolCallId: r.tool_call_id ?? null,
    toolStatus: (r.tool_status as AgentToolStatus | null) ?? null,
    sources: r.sources ?? null,
    widgets: r.widgets ?? null,
    createdAt: r.created_at,
  };
}

export async function loadRun(runId: string): Promise<AgentRun | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("agent_runs").select("*").eq("id", runId).maybeSingle();
  return data ? toRun(data as RunRow) : null;
}

export async function listRuns(engagementId: string): Promise<AgentRun[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("agent_runs")
    .select("*")
    .eq("engagement_id", engagementId)
    .order("updated_at", { ascending: false });
  return ((data ?? []) as RunRow[]).map(toRun);
}

export async function createRun(input: {
  engagementId: string;
  builderId: string;
  title: string;
}): Promise<AgentRun | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("agent_runs")
    .insert({
      engagement_id: input.engagementId,
      builder_id: input.builderId,
      title: input.title.slice(0, 120) || "New conversation",
    })
    .select("*")
    .single();
  if (error || !data) return null;
  return toRun(data as RunRow);
}

/**
 * Create a durable PRD generation run (kind='prd'). Project-scoped — engagement is
 * carried only when the project already has one linked (0039), for the dock's
 * client name. `prdInput` is the DraftPrdInput the route regenerates from, stored
 * so the run is self-contained (a retry needs no wizard round trip).
 */
export async function createPrdRun(input: {
  projectId: string;
  engagementId?: string | null;
  builderId: string;
  title: string;
  prdInput: DraftPrdInput;
}): Promise<AgentRun | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("agent_runs")
    .insert({
      kind: "prd",
      project_id: input.projectId,
      engagement_id: input.engagementId ?? null,
      builder_id: input.builderId,
      title: input.title.slice(0, 120) || "New PRD",
      prd_input: input.prdInput,
    })
    .select("*")
    .single();
  if (error || !data) return null;
  return toRun(data as RunRow);
}

/**
 * Point a chat run at the project the builder is viewing (a `/b/projects/[id]`
 * page), so the document tools scope to it — including on the deferred confirm
 * step, which only has the run to work from. Set from the turn, sticky across
 * turns until the next project page overrides it.
 */
export async function setRunProject(runId: string, projectId: string): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("agent_runs")
    .update({ project_id: projectId, updated_at: new Date().toISOString() })
    .eq("id", runId);
}

/**
 * Pin the page context a chat run was last fired from — the human page label and
 * the specific document in view — so a follow-up keeps it even when sent from the
 * neutral agent workspace (`/b/agent/[runId]`), where the client can't re-derive
 * it. Set from the turn, sticky until the next page overrides it. Mirrors
 * setRunProject; writes only the fields provided so a page-only or doc-only change
 * doesn't clobber the other.
 */
export async function setRunPageContext(
  runId: string,
  patch: { page?: string; viewedDoc?: { kind: "prd" | "quote" | "contract"; id: string } }
): Promise<void> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.page !== undefined) update.page = patch.page;
  if (patch.viewedDoc !== undefined) update.viewed_doc = patch.viewedDoc;
  const admin = createAdminClient();
  await admin.from("agent_runs").update(update).eq("id", runId);
}

/** Whether the builder owns this project — gates trusting a client-supplied
    projectId before pinning it to a run (the doc tools also filter by
    created_by, so this only prevents storing a bogus scope on the run). */
export async function projectOwnedByBuilder(projectId: string, builderId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("owner_id", builderId)
    .maybeSingle();
  return !!data;
}

/** Link a finished PRD run to the document it produced. */
export async function setRunPrdId(runId: string, prdId: string): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("agent_runs")
    .update({ prd_id: prdId, updated_at: new Date().toISOString() })
    .eq("id", runId);
}

export async function renameRun(runId: string, title: string): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("agent_runs")
    .update({ title: title.slice(0, 120) || "New conversation", updated_at: new Date().toISOString() })
    .eq("id", runId);
}

export async function deleteRun(runId: string): Promise<void> {
  const admin = createAdminClient();
  await admin.from("agent_runs").delete().eq("id", runId);
}

export async function setRunStatus(runId: string, status: AgentRunStatus): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("agent_runs")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", runId);
}

/**
 * Atomically claim a turn for THIS caller: flip the run to `thinking`/`reading`
 * only if it isn't already executing. Returns whether the claim succeeded.
 *
 * The whole point is atomicity — two POSTs from a refresh must not both run the
 * model or both insert the user message. A read-then-write guard would race; the
 * conditional UPDATE resolves it in one round trip. `done`/`awaiting_input`/
 * `idle`/`error` runs are claimable (a follow-up answer); `thinking`/
 * `running_tool` runs are already in flight, so the second caller loses.
 */
export async function claimRun(runId: string): Promise<boolean> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data } = await admin
    .from("agent_runs")
    .update({ status: "thinking", phase: "reading", last_event_at: now, updated_at: now })
    .eq("id", runId)
    .not("status", "in", "(thinking,running_tool)")
    .select("id")
    .maybeSingle();
  return !!data;
}

/**
 * Persist a phase transition (+ optional terminal status), bumping liveness.
 * Called transition-only from the SSE route's executor — never per delta.
 */
export async function setRunPhase(
  runId: string,
  phase: AgentPhase,
  status?: AgentRunStatus
): Promise<void> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  await admin
    .from("agent_runs")
    .update({ phase, ...(status ? { status } : {}), last_event_at: now, updated_at: now })
    .eq("id", runId);
}

/** Throttled liveness ping while the model composes (deltas aren't persisted, so
    `updated_at` wouldn't move otherwise and the stale sweep would misfire). */
export async function heartbeatRun(runId: string): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("agent_runs")
    .update({ last_event_at: new Date().toISOString() })
    .eq("id", runId);
}

// The engagement/client fields the dock query joins in one shot so it never has
// to go back for a name. clientName = prospect_name → project name → engagement
// title, mirroring buildClientContext.
type ProjectName = { name: string | null; prospect_name: string | null };
type ActiveRunRow = {
  id: string;
  kind: string | null;
  title: string;
  status: string;
  phase: string | null;
  created_at: string;
  updated_at: string;
  engagement_id: string | null;
  project_id: string | null;
  prd_id: string | null;
  // Chat runs resolve the name through the engagement's project; PRD runs through
  // the directly-linked project (project_id FK).
  engagement:
    | { title: string | null; project: ProjectName | ProjectName[] | null }
    | { title: string | null; project: ProjectName | ProjectName[] | null }[]
    | null;
  project: ProjectName | ProjectName[] | null;
};

function activeClientName(row: ActiveRunRow): string {
  const directProject = Array.isArray(row.project) ? row.project[0] : row.project;
  const eng = Array.isArray(row.engagement) ? row.engagement[0] : row.engagement;
  const engProject = Array.isArray(eng?.project) ? eng?.project[0] : eng?.project;
  const project = directProject ?? engProject;
  return project?.prospect_name ?? project?.name ?? eng?.title ?? "Client";
}

/**
 * All of a builder's runs that are in flight OR finished within the recency
 * window — the dock rehydrates rings from this and polls it as a completion
 * backstop. Admin client bypasses RLS, so the builder_id filter is the
 * authorization (same discipline as getAgentHubData).
 */
export async function listActiveRuns(
  builderId: string,
  recentSinceIso: string
): Promise<ActiveRun[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("agent_runs")
    .select(
      "id, kind, title, status, phase, created_at, updated_at, engagement_id, project_id, prd_id, engagement:engagements(title, project:projects(name, prospect_name)), project:projects(name, prospect_name)"
    )
    .eq("builder_id", builderId)
    .or(`status.in.(thinking,running_tool,awaiting_input),updated_at.gte.${recentSinceIso}`)
    .order("updated_at", { ascending: false });

  return ((data ?? []) as ActiveRunRow[]).map((r) => ({
    id: r.id,
    kind: (r.kind as "chat" | "prd" | null) ?? "chat",
    title: r.title,
    clientName: activeClientName(r),
    engagementId: r.engagement_id,
    projectId: r.project_id,
    prdId: r.prd_id,
    status: r.status as AgentRunStatus,
    phase: (r.phase as AgentPhase | null) ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/**
 * Every run for a builder across ALL their clients and projects — the Agents Hub's
 * cross-client activity feed. Same select join + client-name resolution as
 * listActiveRuns (so the two can't drift), minus the active/recent filter: this
 * returns durable history, all statuses, newest first. The index
 * agent_runs_builder_active_idx (builder_id, updated_at desc) from 0078 fits it
 * exactly. Admin client bypasses RLS, so the builder_id filter IS the
 * authorization (same discipline as listActiveRuns / getAgentHubData).
 */
export async function listAllRunsForBuilder(
  builderId: string,
  opts?: { limit?: number; before?: string; statuses?: AgentRunStatus[] }
): Promise<ActiveRun[]> {
  const admin = createAdminClient();
  // Filters first (each returns the same filter builder, so the conditional
  // reassignment stays type-consistent), then the terminal order/limit.
  let q = admin
    .from("agent_runs")
    .select(
      "id, kind, title, status, phase, created_at, updated_at, engagement_id, project_id, prd_id, engagement:engagements(title, project:projects(name, prospect_name)), project:projects(name, prospect_name)"
    )
    .eq("builder_id", builderId);
  if (opts?.before) q = q.lt("updated_at", opts.before);
  if (opts?.statuses?.length) q = q.in("status", opts.statuses);
  const { data } = await q
    .order("updated_at", { ascending: false })
    .limit(opts?.limit ?? 50);

  return ((data ?? []) as ActiveRunRow[]).map((r) => ({
    id: r.id,
    kind: (r.kind as "chat" | "prd" | null) ?? "chat",
    title: r.title,
    clientName: activeClientName(r),
    engagementId: r.engagement_id,
    projectId: r.project_id,
    prdId: r.prd_id,
    status: r.status as AgentRunStatus,
    phase: (r.phase as AgentPhase | null) ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/**
 * Reconcile crashed executions: a run whose background turn was killed (function
 * timeout / deploy) is stranded `thinking`/`running_tool` with a stale
 * `last_event_at`. Flip those to `error` so no ring hangs forever. Never touches
 * `awaiting_input` — that's legitimately waiting on the builder.
 */
export async function sweepStaleRuns(builderId: string, olderThanIso: string): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("agent_runs")
    .update({ status: "error", phase: "error", updated_at: new Date().toISOString() })
    .eq("builder_id", builderId)
    .in("status", ["thinking", "running_tool"])
    .lt("last_event_at", olderThanIso);
}

export async function loadRunMessages(runId: string): Promise<AgentMessage[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("agent_messages")
    .select("*")
    .eq("run_id", runId)
    .order("created_at", { ascending: true });
  return ((data ?? []) as MessageRow[]).map(toMessage);
}

export async function insertMessage(input: {
  runId: string;
  role: AgentMessageRole;
  content: string;
  toolCalls?: AgentToolCall[] | null;
  toolCallId?: string | null;
  toolStatus?: AgentToolStatus | null;
  sources?: AgentSource[] | null;
  widgets?: AgentWidget[] | null;
}): Promise<AgentMessage | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("agent_messages")
    .insert({
      run_id: input.runId,
      role: input.role,
      content: input.content,
      tool_calls: input.toolCalls ?? null,
      tool_call_id: input.toolCallId ?? null,
      tool_status: input.toolStatus ?? null,
      sources: input.sources ?? null,
      widgets: input.widgets ?? null,
    })
    .select("*")
    .single();
  // Bump the run so listRuns ordering reflects the latest activity.
  await admin.from("agent_runs").update({ updated_at: new Date().toISOString() }).eq("id", input.runId);
  if (error || !data) return null;
  return toMessage(data as MessageRow);
}

export async function getMessage(messageId: string): Promise<AgentMessage | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("agent_messages").select("*").eq("id", messageId).maybeSingle();
  return data ? toMessage(data as MessageRow) : null;
}

export async function setMessageToolStatus(
  messageId: string,
  toolStatus: AgentToolStatus
): Promise<void> {
  const admin = createAdminClient();
  await admin.from("agent_messages").update({ tool_status: toolStatus }).eq("id", messageId);
}
