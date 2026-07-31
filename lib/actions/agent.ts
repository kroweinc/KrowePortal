"use server";

import { getCurrentProfile } from "@/lib/auth";
import { assertEngagementBuilder, getClient } from "@/lib/context/access";
import { createAdminClient } from "@/lib/supabase/server";
import { getProjectById } from "@/lib/actions/projects";
import { draftPrdSchema, type DraftPrdInput } from "@/lib/prd/draft-core";
import {
  createPrdRun,
  createRun,
  deleteRun,
  getMessage,
  insertMessage,
  listActiveRuns,
  listAllRunsForBuilder,
  listRuns,
  loadRun,
  loadRunMessages,
  renameRun,
  setMessageToolStatus,
  setRunStatus,
  sweepStaleRuns,
} from "@/lib/agent/store";
import { getTool } from "@/lib/agent/tools";
import type { DocEditEvent } from "@/lib/agent/doc-events";
import type {
  ActiveRun,
  AgentHubData,
  AgentMessage,
  AgentRun,
  AgentRunStatus,
  EngagementContextSummary,
} from "@/lib/agent/types";

// Server actions for the Agents Control Center. Every export authorizes:
// builder role + ownership of the run's engagement (assertEngagementBuilder).
// The turn itself runs over the SSE route (app/api/ai/agent/stream); these
// cover run lifecycle + history.

async function currentBuilderId(): Promise<string | null> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "builder") return null;
  return profile.id;
}

/**
 * Load a run only if this builder owns it. Chat runs authorize through the
 * engagement (assertEngagementBuilder); PRD runs are project-scoped, so builder_id
 * ownership is the check (same discipline as getActiveRuns' builder_id filter).
 */
async function ownedRun(runId: string, builderId: string): Promise<AgentRun | null> {
  const run = await loadRun(runId);
  if (!run) return null;
  if (run.builderId !== builderId) return null;
  if (run.kind === "prd") return run.projectId ? run : null;
  if (!run.engagementId) return null;
  if (!(await assertEngagementBuilder(run.engagementId, builderId))) return null;
  return run;
}

/** First line of the opening message, tidied into a short run title. */
function deriveTitle(firstMessage?: string): string {
  const line = (firstMessage ?? "").trim().split("\n")[0].trim();
  if (!line) return "New conversation";
  return line.length > 60 ? line.slice(0, 57).trimEnd() + "…" : line;
}

export async function createAgentRun(
  engagementId: string,
  firstMessage?: string
): Promise<{ run: AgentRun } | { error: string }> {
  const builderId = await currentBuilderId();
  if (!builderId) return { error: "Builder only." };
  if (!(await assertEngagementBuilder(engagementId, builderId))) return { error: "Not your client." };

  const run = await createRun({ engagementId, builderId, title: deriveTitle(firstMessage) });
  if (!run) return { error: "Couldn't start a conversation. Try again." };
  return { run };
}

/**
 * Start a durable PRD generation run. The wizard calls this on the terminal
 * (forceFinal) round instead of streaming inline: it persists the DraftPrdInput on
 * the run, then the client hands the run to the SSE route (app/api/ai/prd/run) via
 * the agent-runs provider, and a progress ring appears in the topbar queue. The
 * run generates + saves server-side under `after()` — durable across navigation.
 */
export async function queuePrdRun(
  payload: DraftPrdInput
): Promise<{ runId: string; projectId: string; title: string } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (profile.role !== "builder") return { error: "Only builders can create PRDs." };

  const parsed = draftPrdSchema.safeParse(payload);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const input = parsed.data;

  const project = await getProjectById(input.projectId);
  if (!project) return { error: "Document not found." };
  if (project.owner_id !== profile.id) return { error: "Not your document." };

  const title = input.title.trim() || `${project.name} — PRD`;

  // Carry the linked engagement (0039) if the project has one so the dock shows the
  // client name; a PRD run generates fine without one.
  const admin = createAdminClient();
  const { data: eng } = await admin
    .from("engagements")
    .select("id")
    .eq("project_id", input.projectId)
    .maybeSingle();

  const run = await createPrdRun({
    projectId: input.projectId,
    engagementId: eng?.id ?? null,
    builderId: profile.id,
    title,
    prdInput: input,
  });
  if (!run) return { error: "Couldn't start PRD generation. Try again." };
  return { runId: run.id, projectId: input.projectId, title };
}

export async function listAgentRuns(engagementId: string): Promise<AgentRun[]> {
  const builderId = await currentBuilderId();
  if (!builderId) return [];
  if (!(await assertEngagementBuilder(engagementId, builderId))) return [];
  return listRuns(engagementId);
}

export async function getAgentRun(
  runId: string
): Promise<{ run: AgentRun; messages: AgentMessage[] } | { error: string }> {
  const builderId = await currentBuilderId();
  if (!builderId) return { error: "Builder only." };
  const run = await ownedRun(runId, builderId);
  if (!run) return { error: "Conversation not found." };
  const messages = await loadRunMessages(runId);
  return { run, messages };
}

/** The engagement fields the hub reads — the switcher's label plus the two keys
    the context counts hang off. Selected in one shot so nothing downstream has
    to go back to the engagements table for them. */
interface HubEngagementRow {
  id: string;
  title: string | null;
  project_id: string | null;
  github_repo_full_name: string | null;
}

/**
 * Counts behind the hub's context chips: how much of this client the agent can
 * see. Head-counts only — never assembles the real context (buildClientContext
 * embeds + retrieves, which would cost seconds on an idle palette open).
 *
 * Takes the engagement row rather than its id: every caller has already read it,
 * and looking `project_id` up again here would put a whole sequential round trip
 * in front of the counts to re-learn a value we're holding.
 *
 * Documents span two keys, mirroring app/b/engagements/[id]/page.tsx: briefs and
 * change orders hang off the engagement, while PRDs/quotes/contracts hang off
 * its project and are owner-scoped by created_by.
 */
async function summarizeContext(
  engagement: HubEngagementRow,
  builderId: string
): Promise<EngagementContextSummary> {
  const supabase = await getClient(builderId);
  const engagementId = engagement.id;
  const projectId = engagement.project_id;
  const head = { count: "exact" as const, head: true };

  const [tasks, briefs, changeOrders, prds, quotes, contracts] = await Promise.all([
    supabase.from("tasks").select("id", head).eq("engagement_id", engagementId),
    supabase.from("briefs").select("id", head).eq("engagement_id", engagementId),
    supabase.from("change_orders").select("id", head).eq("engagement_id", engagementId),
    projectId
      ? supabase.from("prds").select("id", head).eq("project_id", projectId).eq("created_by", builderId)
      : null,
    projectId
      ? supabase.from("quotes").select("id", head).eq("project_id", projectId).eq("created_by", builderId)
      : null,
    projectId
      ? supabase.from("contracts").select("id", head).eq("project_id", projectId).eq("created_by", builderId)
      : null,
  ]);

  const documents = [briefs, changeOrders, prds, quotes, contracts].reduce(
    (sum, res) => sum + (res?.count ?? 0),
    0
  );

  return {
    documents,
    tasks: tasks.count ?? 0,
    repoConnected: !!engagement.github_repo_full_name,
  };
}

/**
 * The hub's whole idle state — the builder's clients, which one is in scope, its
 * recent conversations, and its context counts — in ONE browser hop and TWO
 * database layers.
 *
 * Depth is what costs here, not query count: Supabase is a network away, so each
 * *sequential* layer is ~200ms whether it carries one query or seven. This used
 * to run four deep — clients (a fat select joining projects for columns the hub
 * never reads) → re-check that the scoped client is ours → look its project_id
 * up again → count. Layers 2 and 3 were both asking for things layer 1 already
 * knew, so they're gone:
 *
 *   1. one slim select, filtered by builder_id — which *is* the ownership proof
 *      (a row came back for this builder), and carries project_id and the repo
 *      forward so nothing has to re-read them.
 *   2. runs + all six counts, fanned out in parallel.
 *
 * The exported single-purpose actions keep their own assertEngagementBuilder —
 * they're callable on their own and can't lean on a select they didn't run.
 */
export async function getAgentHubData(
  preferredEngagementId?: string | null
): Promise<AgentHubData> {
  const builderId = await currentBuilderId();
  const empty: AgentHubData = { engagements: [], engagementId: null, runs: [], summary: null };
  if (!builderId) return empty;

  // Admin client + explicit builder_id filter, mirroring getMyEngagements (see
  // its note on why RLS can't serve the joined reads) — but selecting only what
  // the hub paints instead of `*` plus the project's context blob.
  const admin = createAdminClient();
  const { data } = await admin
    .from("engagements")
    .select("id, title, project_id, github_repo_full_name")
    // Only live engagements — exclude shells created when an operator accepted a
    // doc but the build hasn't begun (see migration 0057).
    .not("started_at", "is", null)
    .eq("builder_id", builderId)
    .order("created_at", { ascending: true });

  const rows = (data ?? []) as HubEngagementRow[];
  const engagements = rows.map((r) => ({ id: r.id, title: r.title ?? "", projectId: r.project_id }));

  // Same rule the console applied client-side: prefer the client whose page
  // we're on, else the most recently created (the order above is ascending).
  const scoped =
    rows.find((r) => r.id === preferredEngagementId) ?? rows[rows.length - 1] ?? null;
  if (!scoped) return { ...empty, engagements };

  const [runs, summary] = await Promise.all([
    listRuns(scoped.id),
    summarizeContext(scoped, builderId),
  ]);

  return { engagements, engagementId: scoped.id, runs, summary };
}

// How long a run may sit `thinking`/`running_tool` with no liveness ping before
// it's presumed dead (function timeout / deploy) and swept to `error`. A turn is
// seconds; 3 min is comfortably longer while still self-healing fast.
const STALE_RUN_MS = 3 * 60_000;
// Runs finished within this window are still returned so a client that polls just
// after completion catches the terminal transition (the dropped-SSE backstop).
const ACTIVE_RECENT_MS = 60_000;

/**
 * Every in-flight (or just-finished) run for the current builder — what the
 * floating agent dock polls to rehydrate rings after a refresh and to catch
 * server-side completions it isn't streaming. Reconciles crashed runs first so a
 * dead one never lingers as a spinning ring.
 */
export async function getActiveRuns(): Promise<ActiveRun[]> {
  const builderId = await currentBuilderId();
  if (!builderId) return [];
  const now = Date.now();
  await sweepStaleRuns(builderId, new Date(now - STALE_RUN_MS).toISOString());
  return listActiveRuns(builderId, new Date(now - ACTIVE_RECENT_MS).toISOString());
}

/**
 * Every run for the current builder across ALL their clients and projects — the
 * Agents Hub's cross-client activity feed (active + history). Sweeps crashed runs
 * first (like getActiveRuns) so a dead run reads `error`, not a frozen `thinking`,
 * in history. builder_id is the ownership proof (admin client bypasses RLS); the
 * per-run open path still re-authorizes through getAgentRun/ownedRun.
 */
export async function listAllAgentRuns(opts?: {
  limit?: number;
  before?: string;
  statuses?: AgentRunStatus[];
}): Promise<ActiveRun[]> {
  const builderId = await currentBuilderId();
  if (!builderId) return [];
  await sweepStaleRuns(builderId, new Date(Date.now() - STALE_RUN_MS).toISOString());
  return listAllRunsForBuilder(builderId, opts);
}

export async function renameAgentRun(
  runId: string,
  title: string
): Promise<{ success: true } | { error: string }> {
  const builderId = await currentBuilderId();
  if (!builderId) return { error: "Builder only." };
  const run = await ownedRun(runId, builderId);
  if (!run) return { error: "Conversation not found." };
  const clean = title.trim();
  if (!clean) return { error: "Give the conversation a name." };
  await renameRun(runId, clean);
  return { success: true };
}

export async function deleteAgentRun(
  runId: string
): Promise<{ success: true } | { error: string }> {
  const builderId = await currentBuilderId();
  if (!builderId) return { error: "Builder only." };
  const run = await ownedRun(runId, builderId);
  if (!run) return { error: "Conversation not found." };
  await deleteRun(runId);
  return { success: true };
}

/**
 * Clear a run that's stuck `awaiting_input` — the builder is done with the
 * pending proposal and wants the "needs you" ring gone without opening the
 * thread to act on it. Cancels any still-pending proposal (its write tool never
 * runs) and settles the run to `done`, so getActiveRuns stops returning it as
 * in-flight and it can't resurrect the ring on the next poll. Idempotent: a run
 * that's already past awaiting_input just no-ops to success.
 */
export async function dismissAgentRun(
  runId: string
): Promise<{ success: true } | { error: string }> {
  const builderId = await currentBuilderId();
  if (!builderId) return { error: "Builder only." };
  const run = await ownedRun(runId, builderId);
  if (!run) return { error: "Conversation not found." };
  if (run.status !== "awaiting_input") return { success: true };
  // Cancel the pending proposal so a later confirm can never fire the write.
  const messages = await loadRunMessages(runId);
  const pending = messages.find((m) => m.toolStatus === "proposed");
  if (pending) await setMessageToolStatus(pending.id, "rejected");
  await setRunStatus(runId, "done");
  return { success: true };
}

// ── Tool-call confirmation ────────────────────────────────────────────────
// A proposed write tool (assistant message with tool_calls + tool_status
// "proposed") executes only when the builder confirms. Authorizes ownership of
// the run's engagement before running anything.

async function ownedProposal(messageId: string, builderId: string) {
  const message = await getMessage(messageId);
  if (!message) return null;
  const run = await loadRun(message.runId);
  // Tool proposals only exist on chat runs (PRD runs have no tools).
  if (!run || !run.engagementId) return null;
  if (!(await assertEngagementBuilder(run.engagementId, builderId))) return null;
  return { message, run };
}

export async function confirmToolCall(
  messageId: string
): Promise<{ results: string[]; docEdits: DocEditEvent[] } | { error: string }> {
  const builderId = await currentBuilderId();
  if (!builderId) return { error: "Builder only." };
  const owned = await ownedProposal(messageId, builderId);
  if (!owned) return { error: "Proposal not found." };
  const { message, run } = owned;
  if (!message.toolCalls?.length || message.toolStatus !== "proposed") {
    return { error: "This action isn't pending anymore." };
  }
  // ownedProposal already guaranteed a chat run with an engagement.
  const engagementId = run.engagementId;
  if (!engagementId) return { error: "This action isn't pending anymore." };

  await setRunStatus(run.id, "running_tool");
  const results: string[] = [];
  // Documents a write tool just persisted — returned to the client so an open
  // view of one reflects the edit live (see lib/agent/doc-events.ts).
  const docEdits: DocEditEvent[] = [];
  for (const call of message.toolCalls) {
    const tool = getTool(call.name);
    if (!tool || tool.kind !== "write") {
      results.push(`Skipped unrecognized action: ${call.name}`);
      continue;
    }
    try {
      const r = await tool.execute(call.arguments, {
        engagementId,
        builderId,
        projectId: run.projectId ?? undefined,
      });
      results.push(r.content);
      if (r.docEdit) docEdits.push(r.docEdit);
    } catch (err) {
      results.push(`Failed: ${err instanceof Error ? err.message : "error"}`);
    }
  }

  await insertMessage({
    runId: run.id,
    role: "tool",
    content: results.join("\n"),
    toolCallId: message.toolCalls[0].id,
    toolStatus: "executed",
  });
  await setMessageToolStatus(messageId, "executed");
  await setRunStatus(run.id, "done");
  return { results, docEdits };
}

export async function rejectToolCall(
  messageId: string
): Promise<{ success: true } | { error: string }> {
  const builderId = await currentBuilderId();
  if (!builderId) return { error: "Builder only." };
  const owned = await ownedProposal(messageId, builderId);
  if (!owned) return { error: "Proposal not found." };
  const { message, run } = owned;
  if (message.toolStatus !== "proposed") return { error: "This action isn't pending anymore." };
  await setMessageToolStatus(messageId, "rejected");
  await setRunStatus(run.id, "done");
  return { success: true };
}
