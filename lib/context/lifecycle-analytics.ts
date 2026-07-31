import "server-only";

import { getCurrentProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { assertEngagementBuilder } from "@/lib/context/access";
import { humanDuration } from "@/lib/context/duration";
import type { DocActorRole, DocEventKind, DocEventType } from "@/lib/context/document-events";

// ============================================================
// Lifecycle analytics — the engagement-wide interaction timeline + timing
// rollups. Unifies the two append-only logs the platform already keeps
// (document_events 0061 + task_audit_log 0018) and the durable relationship
// timestamps (engagement created/started, operator joined) into ONE
// chronological story, then computes the "time between each stage" the way the
// done-task nodes already compute created→completed.
//
// Split in two: PURE functions (buildLifecycles / computeEngagementAnalytics)
// that do only math on a flat entry list — unit-testable, no I/O — and one
// server loader (getEngagementTimeline) that reads the logs, maps them to
// entries, and runs the pure layer. Builder-only.
// ============================================================

export type TimelineKind = "document" | "task" | "relationship";

/** One discrete stage transition of a single artifact (doc / task / the engagement). */
export interface TimelineEntry {
  kind: TimelineKind;
  entityId: string; // doc_id, task_id, or "engagement"
  entityLabel: string;
  docKind?: DocEventKind;
  stage: string; // human stage label, e.g. "sent", "signed", "in progress", "done"
  actorRole: DocActorRole | null;
  actorName: string | null; // signer name on signed/accepted, else null
  at: string; // ISO timestamp
  sincePreviousMs: number | null; // gap from the prior stage OF THE SAME entity (filled by buildLifecycles)
  sincePreviousLabel: string | null;
  detail: string | null; // change-request / rejection text
}

/** All stages of one artifact, ordered, with inter-stage gaps + total elapsed. */
export interface EntityLifecycle {
  kind: TimelineKind;
  entityId: string;
  entityLabel: string;
  docKind?: DocEventKind;
  stages: TimelineEntry[];
  totalElapsedMs: number | null; // first → last stage
  totalElapsedLabel: string | null;
  currentStage: string;
  isTerminal: boolean;
  lastActivityAt: string; // = last stage's timestamp (used to order entities by recency)
}

/** Engagement-level rollups derived from every stage transition. */
export interface EngagementAnalytics {
  lastActivityAt: string | null;
  lastActivityLabel: string | null; // "3 days ago"
  recencyMs: number | null;
  totalEvents: number;
  docsSent: number;
  docsSigned: number;
  avgTimeToSignMs: number | null; // mean(sent → signed/accepted) across signed docs
  avgTimeToSignLabel: string | null;
  fastestSignLabel: string | null;
  responseCadenceMs: number | null; // mean gap between consecutive client/operator events
  responseCadenceLabel: string | null;
  tasksCompleted: number;
  avgTaskCycleMs: number | null; // mean(created → done) across done tasks
  avgTaskCycleLabel: string | null;
}

export interface EngagementTimeline {
  entries: TimelineEntry[]; // flat, time-sorted (raw, no gaps)
  lifecycles: EntityLifecycle[]; // grouped by entity, with gaps + totals
  analytics: EngagementAnalytics;
}

// ── Pure layer ──────────────────────────────────────────────────────────────

function isTerminalStage(kind: TimelineKind, stage: string): boolean {
  if (kind === "document") return ["signed", "accepted", "rejected", "deleted"].includes(stage);
  if (kind === "task") return stage === "done";
  return false;
}

function avg(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function cmpAt(a: { at: string }, b: { at: string }): number {
  return a.at < b.at ? -1 : a.at > b.at ? 1 : 0;
}

/**
 * Group a flat entry list by entity and fill each entry's gap-from-previous
 * (same entity) plus the entity's total elapsed (first → last). Pure.
 */
export function buildLifecycles(entries: TimelineEntry[]): EntityLifecycle[] {
  const groups = new Map<string, TimelineEntry[]>();
  for (const e of entries) {
    const key = `${e.kind}:${e.entityId}`;
    const arr = groups.get(key) ?? [];
    arr.push(e);
    groups.set(key, arr);
  }

  const lifecycles: EntityLifecycle[] = [];
  for (const raw of groups.values()) {
    const sorted = [...raw].sort(cmpAt);
    const stages: TimelineEntry[] = sorted.map((e, i) => {
      if (i === 0) return { ...e, sincePreviousMs: null, sincePreviousLabel: null };
      const ms = new Date(e.at).getTime() - new Date(sorted[i - 1].at).getTime();
      return { ...e, sincePreviousMs: ms, sincePreviousLabel: humanDuration(ms) };
    });
    const first = stages[0];
    const last = stages[stages.length - 1];
    const totalMs =
      stages.length > 1 ? new Date(last.at).getTime() - new Date(first.at).getTime() : null;
    lifecycles.push({
      kind: first.kind,
      entityId: first.entityId,
      entityLabel: first.entityLabel,
      docKind: first.docKind,
      stages,
      totalElapsedMs: totalMs,
      totalElapsedLabel: totalMs != null ? humanDuration(totalMs) : null,
      currentStage: last.stage,
      isTerminal: isTerminalStage(last.kind, last.stage),
      lastActivityAt: last.at,
    });
  }
  return lifecycles;
}

/**
 * Roll a set of lifecycles up into engagement-level stats: recency, document
 * throughput (sent/signed + avg/fastest time-to-sign), client response cadence,
 * and task cycle time. Pure — pass `now` so it's deterministic in tests.
 */
export function computeEngagementAnalytics(
  lifecycles: EntityLifecycle[],
  now: Date
): EngagementAnalytics {
  const allStages = lifecycles.flatMap((l) => l.stages);
  if (!allStages.length) {
    return {
      lastActivityAt: null,
      lastActivityLabel: null,
      recencyMs: null,
      totalEvents: 0,
      docsSent: 0,
      docsSigned: 0,
      avgTimeToSignMs: null,
      avgTimeToSignLabel: null,
      fastestSignLabel: null,
      responseCadenceMs: null,
      responseCadenceLabel: null,
      tasksCompleted: 0,
      avgTaskCycleMs: null,
      avgTaskCycleLabel: null,
    };
  }

  let lastAt = "";
  for (const s of allStages) if (s.at > lastAt) lastAt = s.at;
  const recencyMs = lastAt ? now.getTime() - new Date(lastAt).getTime() : null;

  let docsSent = 0;
  let docsSigned = 0;
  const signDurations: number[] = [];
  const taskCycles: number[] = [];
  for (const lc of lifecycles) {
    if (lc.kind === "document") {
      const sent = lc.stages.find((s) => s.stage === "sent");
      const signed = lc.stages.find((s) => s.stage === "signed" || s.stage === "accepted");
      if (sent) docsSent++;
      if (signed) docsSigned++;
      if (sent && signed) {
        const d = new Date(signed.at).getTime() - new Date(sent.at).getTime();
        if (d >= 0) signDurations.push(d);
      }
    } else if (lc.kind === "task") {
      const created = lc.stages.find((s) => s.stage === "created");
      const done = lc.stages.find((s) => s.stage === "done");
      if (created && done) {
        const d = new Date(done.at).getTime() - new Date(created.at).getTime();
        if (d >= 0) taskCycles.push(d);
      }
    }
  }
  const tasksCompleted = lifecycles.filter(
    (l) => l.kind === "task" && l.stages.some((s) => s.stage === "done")
  ).length;

  // Client response cadence: how often the client/operator side acts.
  const clientStages = allStages
    .filter((s) => s.actorRole === "client" || s.actorRole === "operator")
    .sort(cmpAt);
  const cadenceGaps: number[] = [];
  for (let i = 1; i < clientStages.length; i++) {
    cadenceGaps.push(
      new Date(clientStages[i].at).getTime() - new Date(clientStages[i - 1].at).getTime()
    );
  }

  const avgSign = avg(signDurations);
  const fastestSign = signDurations.length ? Math.min(...signDurations) : null;
  const avgCadence = avg(cadenceGaps);
  const avgCycle = avg(taskCycles);

  return {
    lastActivityAt: lastAt || null,
    lastActivityLabel: recencyMs != null ? `${humanDuration(recencyMs)} ago` : null,
    recencyMs,
    totalEvents: allStages.length,
    docsSent,
    docsSigned,
    avgTimeToSignMs: avgSign,
    avgTimeToSignLabel: avgSign != null ? humanDuration(avgSign) : null,
    fastestSignLabel: fastestSign != null ? humanDuration(fastestSign) : null,
    responseCadenceMs: avgCadence,
    responseCadenceLabel: avgCadence != null ? humanDuration(avgCadence) : null,
    tasksCompleted,
    avgTaskCycleMs: avgCycle,
    avgTaskCycleLabel: avgCycle != null ? humanDuration(avgCycle) : null,
  };
}

// ── Loader (server) ─────────────────────────────────────────────────────────

// Human stage label per document lifecycle event.
const DOC_STAGE_LABEL: Record<DocEventType, string> = {
  created: "created",
  sent: "sent",
  viewed: "viewed",
  changes_requested: "changes requested",
  re_sent: "re-sent",
  accepted: "accepted",
  signed: "signed",
  rejected: "rejected",
  deleted: "deleted",
};

// Task audit actions that represent a real stage transition (status moves +
// the approval handshake). task.completed is intentionally excluded — it's
// redundant with the status_changed→done it's written alongside; task.field_changed
// is a content edit, not a stage.
const TASK_STAGE_ACTIONS = [
  "task.created",
  "task.status_changed",
  "task.sent_for_approval",
  "task.approved",
] as const;

function prettyDocKind(kind: DocEventKind): string {
  switch (kind) {
    case "prd":
      return "PRD";
    case "quote":
      return "Quote";
    case "contract":
      return "Contract";
    case "brief":
      return "Brief";
    case "change_order":
      return "Change Order";
    default:
      return "Document";
  }
}

function taskStatusLabel(status: string): string {
  switch (status) {
    case "in_progress":
      return "in progress";
    case "blocked":
      return "blocked";
    case "done":
      return "done";
    case "inbox":
      return "inbox";
    default:
      return status;
  }
}

function coerceStr(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function roleFor(
  actorId: string | null,
  builderId: string | null,
  operatorId: string | null
): DocActorRole | null {
  if (!actorId) return "system";
  if (builderId && actorId === builderId) return "builder";
  if (operatorId && actorId === operatorId) return "operator";
  return null;
}

function docDetail(payload: Record<string, unknown>): string | null {
  if (typeof payload.changesText === "string" && payload.changesText.trim())
    return payload.changesText.trim();
  if (typeof payload.rejectionNote === "string" && payload.rejectionNote.trim())
    return payload.rejectionNote.trim();
  return null;
}

const EMPTY: EngagementTimeline = {
  entries: [],
  lifecycles: [],
  analytics: computeEngagementAnalytics([], new Date(0)),
};

/**
 * Assemble the full builder↔client interaction timeline for an engagement:
 * every document lifecycle event, every task stage transition, and the
 * relationship milestones — chronological, with the time between each stage and
 * engagement-level rollups. Builder-only; reads via the admin client after
 * ownership is asserted (mirrors getClientGraph).
 */
export async function getEngagementTimeline(engagementId: string): Promise<EngagementTimeline> {
  const profile = await getCurrentProfile();
  if (!profile) return EMPTY;
  if (!(await assertEngagementBuilder(engagementId, profile.id))) return EMPTY;

  const admin = createAdminClient();

  const { data: eng } = await admin
    .from("engagements")
    .select("id, title, created_at, started_at, project_id, builder_id, operator_id")
    .eq("id", engagementId)
    .maybeSingle();
  if (!eng) return EMPTY;

  const projectId = (eng.project_id as string | null) ?? null;
  const builderId = (eng.builder_id as string | null) ?? null;
  const operatorId = (eng.operator_id as string | null) ?? null;
  const engTitle = (eng.title as string) || "Engagement";

  // Read the two append-only logs + the doc-title sources + the invite, all in parallel.
  const [evRes, taRes, prdRes, quoteRes, contractRes, coRes, invRes] = await Promise.all([
    admin
      .from("document_events")
      .select("doc_kind, doc_id, event_type, actor_role, payload, created_at")
      .eq("engagement_id", engagementId)
      .order("created_at", { ascending: true }),
    admin
      .from("task_audit_log")
      .select("task_id, actor_id, action, new_value, created_at, task:tasks!inner(engagement_id, title)")
      .eq("task.engagement_id", engagementId)
      .in("action", TASK_STAGE_ACTIONS as unknown as string[])
      .order("created_at", { ascending: true }),
    projectId
      ? admin.from("prds").select("id, title").eq("project_id", projectId)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    projectId
      ? admin.from("quotes").select("id, title").eq("project_id", projectId)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    projectId
      ? admin.from("contracts").select("id, title").eq("project_id", projectId)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    admin.from("change_orders").select("id, title").eq("engagement_id", engagementId),
    admin
      .from("invitations")
      .select("accepted_at")
      .eq("engagement_id", engagementId)
      .not("accepted_at", "is", null)
      .order("accepted_at", { ascending: true })
      .limit(1),
  ]);

  // docId → title (namespaced by kind, since ids are only unique per table).
  const docTitle = new Map<string, string>();
  const addTitles = (kind: DocEventKind, rows: { id: string; title: string }[] | null) => {
    for (const r of rows ?? []) docTitle.set(`${kind}:${r.id}`, r.title);
  };
  addTitles("prd", prdRes.data);
  addTitles("quote", quoteRes.data);
  addTitles("contract", contractRes.data);
  addTitles("change_order", coRes.data);

  const entries: TimelineEntry[] = [];

  // 1) Document lifecycle events.
  for (const ev of (evRes.data ?? []) as {
    doc_kind: DocEventKind;
    doc_id: string;
    event_type: DocEventType;
    actor_role: DocActorRole | null;
    payload: Record<string, unknown> | null;
    created_at: string;
  }[]) {
    const payload = ev.payload ?? {};
    entries.push({
      kind: "document",
      entityId: ev.doc_id,
      entityLabel: docTitle.get(`${ev.doc_kind}:${ev.doc_id}`) ?? prettyDocKind(ev.doc_kind),
      docKind: ev.doc_kind,
      stage: DOC_STAGE_LABEL[ev.event_type] ?? ev.event_type,
      actorRole: ev.actor_role ?? null,
      actorName: typeof payload.signerName === "string" ? payload.signerName : null,
      at: ev.created_at,
      sincePreviousMs: null,
      sincePreviousLabel: null,
      detail: docDetail(payload),
    });
  }

  // 2) Task stage transitions (grouped per task so we can dedupe the
  //    blocked→sent-for-approval double the approval flow writes at the same instant).
  const taskEntries = new Map<string, TimelineEntry[]>();
  for (const row of (taRes.data ?? []) as {
    task_id: string;
    actor_id: string | null;
    action: string;
    new_value: unknown;
    created_at: string;
    task: { engagement_id: string; title: string } | { engagement_id: string; title: string }[] | null;
  }[]) {
    const task = Array.isArray(row.task) ? row.task[0] : row.task;
    let stage: string;
    if (row.action === "task.created") stage = "created";
    else if (row.action === "task.sent_for_approval") stage = "sent for approval";
    else if (row.action === "task.approved") stage = "approved";
    else if (row.action === "task.status_changed") stage = taskStatusLabel(coerceStr(row.new_value));
    else continue;
    const arr = taskEntries.get(row.task_id) ?? [];
    arr.push({
      kind: "task",
      entityId: row.task_id,
      entityLabel: task?.title ?? "Task",
      stage,
      actorRole: roleFor(row.actor_id, builderId, operatorId),
      actorName: null,
      at: row.created_at,
      sincePreviousMs: null,
      sincePreviousLabel: null,
      detail: null,
    });
    taskEntries.set(row.task_id, arr);
  }
  for (const arr of taskEntries.values()) {
    arr.sort(cmpAt);
    // Drop a "blocked" stage immediately followed by "sent for approval" at the
    // same timestamp — the approval handshake writes both; the latter is meaningful.
    for (let i = 0; i < arr.length - 1; i++) {
      if (
        arr[i].stage === "blocked" &&
        arr[i + 1].stage === "sent for approval" &&
        arr[i].at === arr[i + 1].at
      ) {
        arr.splice(i, 1);
        i--;
      }
    }
    entries.push(...arr);
  }

  // 3) Relationship milestones, synthesized from durable timestamps (mirrors the
  //    0061 backfill philosophy — no event table needed for these).
  const relAdd = (stage: string, at: string | null, role: DocActorRole) => {
    if (!at) return;
    entries.push({
      kind: "relationship",
      entityId: "engagement",
      entityLabel: engTitle,
      stage,
      actorRole: role,
      actorName: null,
      at,
      sincePreviousMs: null,
      sincePreviousLabel: null,
      detail: null,
    });
  };
  relAdd("created", (eng.created_at as string | null) ?? null, "builder");
  relAdd("started", (eng.started_at as string | null) ?? null, "builder");
  relAdd("operator joined", (invRes.data?.[0]?.accepted_at as string | null) ?? null, "operator");

  entries.sort(cmpAt);
  const lifecycles = buildLifecycles(entries);
  const analytics = computeEngagementAnalytics(lifecycles, new Date());

  return { entries, lifecycles, analytics };
}
