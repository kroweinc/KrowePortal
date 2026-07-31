import type { QueueItem, RunPhase } from "@/components/agent/agent-runs-provider";
import type { ActiveRun, AgentPhase, AgentRunStatus } from "@/lib/agent/types";

// Pure, testable merge of the Agents Hub feed: durable server history
// (listAllAgentRuns → ActiveRun[]) reconciled with the live in-flight runs the
// provider holds (useAgentRunsSummary → QueueItem[]). Keyed by runId, live wins,
// active-first then recency. No React — the feed component wires this to state.

export interface FeedRow {
  runId: string;
  kind: "chat" | "prd";
  title: string;
  clientName: string;
  engagementId: string | null;
  projectId?: string | null;
  prdId?: string | null;
  status: AgentRunStatus;
  /** Normalized to a ring phase (history's "error"/null floor to "done", where the
      ring is full anyway for terminal rows). */
  phase: RunPhase;
  prdSectionsSeen: number;
  prdSectionsTotal: number;
  error?: string | null;
  /** true when a live QueueItem contributed — drives elapsed-vs-relative time and
      the pulsing ring. */
  live: boolean;
  startedAt: number;
  finishedAt?: number;
  /** ISO — the relative "when" label on history (non-live) rows. */
  updatedAt: string;
  /** ms — the ordering key (see mergeFeed). */
  sortAt: number;
}

const ACTIVE: AgentRunStatus[] = ["thinking", "running_tool", "awaiting_input"];

export function isActiveStatus(s: AgentRunStatus): boolean {
  return ACTIVE.includes(s);
}

/** An ActiveRun's phase is AgentPhase | null (includes "error"); the ring helpers
    want a RunPhase. History rows are effectively always terminal, where the ring
    ignores phase, so "done" is a safe floor. */
function toRunPhase(phase: AgentPhase | null): RunPhase {
  return phase === "reading" || phase === "searching" || phase === "composing" || phase === "done"
    ? phase
    : "done";
}

export function mergeFeed(server: ActiveRun[], live: QueueItem[]): FeedRow[] {
  const rows = new Map<string, FeedRow>();

  for (const r of server) {
    rows.set(r.id, {
      runId: r.id,
      kind: r.kind,
      title: r.title,
      clientName: r.clientName,
      engagementId: r.engagementId,
      projectId: r.projectId ?? null,
      prdId: r.prdId ?? null,
      status: r.status,
      phase: toRunPhase(r.phase),
      prdSectionsSeen: 0,
      prdSectionsTotal: 22,
      error: null,
      live: false,
      startedAt: Date.parse(r.createdAt),
      finishedAt: undefined,
      updatedAt: r.updatedAt,
      sortAt: Date.parse(r.updatedAt),
    });
  }

  // Live overlay wins on the volatile fields; falls back to server for the stable
  // display fields it doesn't carry. A live-only run (started this session, not yet
  // in a history page) becomes a fresh row.
  for (const q of live) {
    const base = rows.get(q.runId);
    rows.set(q.runId, {
      runId: q.runId,
      kind: q.kind,
      title: q.title || base?.title || "Run",
      clientName: q.clientName || base?.clientName || "Client",
      engagementId: q.engagementId ?? base?.engagementId ?? null,
      projectId: q.projectId ?? base?.projectId ?? null,
      prdId: q.prdId ?? base?.prdId ?? null,
      status: q.status,
      phase: q.phase,
      prdSectionsSeen: q.prdSectionsSeen,
      prdSectionsTotal: q.prdSectionsTotal,
      error: q.error ?? null,
      live: true,
      startedAt: q.startedAt,
      finishedAt: q.finishedAt,
      updatedAt: base?.updatedAt ?? new Date(q.finishedAt ?? q.startedAt).toISOString(),
      sortAt: q.finishedAt ?? q.startedAt,
    });
  }

  const rank = (r: FeedRow) => (isActiveStatus(r.status) ? 0 : 1);
  return [...rows.values()].sort((a, b) => rank(a) - rank(b) || b.sortAt - a.sortAt);
}
