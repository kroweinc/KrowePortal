"use client";

import * as React from "react";
import { toast } from "sonner";

import { dismissAgentRun, getActiveRuns } from "@/lib/actions/agent";
import { streamAgentTurn, streamPrdRun } from "@/lib/agent/stream-client";
import type {
  ActiveRun,
  AgentRunStatus,
  AgentSource,
  AgentToolCall,
  AgentWidget,
  PrdRunEvent,
} from "@/lib/agent/types";
import type { PrdContent } from "@/lib/types";
import type { ViewedDoc } from "@/lib/nav-commands";

// ============================================================================
// Global owner of every in-flight agent turn.
//
// Streaming used to live inside <AgentThread>, which the ⌘K palette unmounts on
// close — so closing the palette aborted the run. This provider hoists that
// ownership above the palette (mounted in app/b/layout.tsx), so a run keeps
// streaming across palette-close and route navigation, and — because the SSE
// route now completes the turn server-side under `after()` — survives a full
// refresh too. It feeds the topbar <AgentRunDock/> one progress ring per run
// and lets any mounted conversation bind to a run's live state by id.
//
// It's an external store (refs + useSyncExternalStore, NOT React state): deltas
// fire many times a second, and per-run selectors mean a token on run A only
// re-renders run A's ring, never run B's or the whole dock.
// ============================================================================

export type RunPhase = "reading" | "searching" | "composing" | "done";

/** How full each phase paints the ring. */
export const PHASE_FILL: Record<RunPhase, number> = {
  reading: 0.25,
  searching: 0.6,
  composing: 0.9,
  done: 1,
};

export interface LiveRun {
  runId: string;
  /** 'chat' — a grounded conversation; 'prd' — a durable PRD generation run. */
  kind: "chat" | "prd";
  engagementId: string | null;
  /** PRD runs: the project the PRD belongs to + (once done) the PRD id, so the ring
      and thread can link straight to the document. */
  projectId?: string | null;
  prdId?: string | null;
  clientName: string;
  title: string;
  status: AgentRunStatus;
  phase: RunPhase;
  streamingContent: string;
  sources: AgentSource[];
  widgets: AgentWidget[];
  /** PRD runs: the document assembling live (complete sections only) + how many of
      the ~22 sections have closed, for the live widget and section-honest ring. */
  prdPartial?: PrdContent | null;
  prdSectionsSeen: number;
  prdSectionsTotal: number;
  toolCalls?: AgentToolCall[] | null;
  toolStatus?: string | null;
  finalMessageId?: string;
  error?: string | null;
  /** true while this client holds an open SSE for the run. */
  streaming: boolean;
  /** rehydrated from getActiveRuns with no local stream — driven by the poll. */
  detached?: boolean;
  /** wall-clock start (ms) — drives the queue's elapsed timer. From Date.now()
      for a run we started, or the run's created_at for one we hydrated. */
  startedAt: number;
  finishedAt?: number;
  /** set ~360ms before eviction so the ring can play its exit transition. */
  leaving?: boolean;
  createdSeq: number;
  updatedAt: number;
}

/**
 * The phase/status-level projection of a run the queue chip + popover paint. It
 * deliberately drops streamingContent/sources/widgets so a token delta (which
 * fires many times a second) doesn't churn the queue — only a phase change,
 * status change, or the set of runs does. The store memoizes it (see
 * getSummary): identical successive snapshots keep the same array ref, so
 * useSyncExternalStore skips the re-render.
 */
export interface QueueItem {
  runId: string;
  kind: "chat" | "prd";
  engagementId: string | null;
  projectId?: string | null;
  prdId?: string | null;
  clientName: string;
  title: string;
  status: AgentRunStatus;
  phase: RunPhase;
  /** PRD runs: closed-section count, so the dock ring fills honestly per section
      (chat runs leave this 0 and fill by phase). */
  prdSectionsSeen: number;
  prdSectionsTotal: number;
  startedAt: number;
  finishedAt?: number;
  error?: string | null;
  leaving?: boolean;
}

export interface StartRunArgs {
  runId: string;
  /** Defaults to 'chat'. 'prd' streams the durable PRD run route instead. */
  kind?: "chat" | "prd";
  engagementId: string | null;
  projectId?: string | null;
  /** The specific document in view when the turn was started, so the agent
      assumes it for an untitled "change the document" request. Chat turns only. */
  viewedDoc?: ViewedDoc | null;
  /** The PRD section in view (e.g. "techStack"), so the agent assumes it as the
      target of an ambiguous section change ("change the tech stack"). Chat turns
      only; per-turn (not sticky) — the PRD page always re-derives it. */
  viewedSection?: string | null;
  clientName: string;
  title: string;
  /** Required for a chat turn; unused for a PRD run (the input lives on the run). */
  message?: string;
  /** A human label for the page the turn was started from ("the Tasks board") —
      the agent leans ambiguous requests toward it. Chat turns only. */
  page?: string;
}

export interface AgentRunsApi {
  startRun(args: StartRunArgs): void;
  stopRun(runId: string): void;
  /** Clear a finished (or errored) run from the queue now, rather than waiting on
      its linger timer. No-op on a still-running run — there's no server cancel. */
  dismissRun(runId: string): void;
  /** Clear a run stuck `awaiting_input`: cancel its pending proposal server-side,
      then evict the ring. Unlike dismissRun (local-only, terminal runs), this
      settles the run in the DB so the poll can't resurrect the "needs you" ring. */
  cancelRun(runId: string): void;
  /** Settle a run the builder just acted on INLINE (confirmed or rejected its
      proposal in the thread): the server already flipped it to `done`, so mark the
      local copy done and let it fade on the normal linger instead of nagging as
      "needs you" forever. No-op unless the run is parked `awaiting_input`. */
  resolveRun(runId: string): void;
  getRun(runId: string): LiveRun | undefined;
}

// A finished/errored run lingers in the queue this long so the builder can open
// its result from the popover before it fades — the toast is a transient ping,
// the queue is the durable list. Kept under ACTIVE_RECENT_MS (60s) so the poll
// has stopped returning the run by the time it evicts (no resurrection race).
const DONE_LINGER_MS = 55_000;
// A run the builder just resolved by hand (confirmed/rejected inline) fades on a
// much shorter beat than DONE_LINGER_MS: the long linger exists so a run that
// finishes ON ITS OWN stays around long enough to be noticed, but an explicit
// approve is proof the builder is already looking — holding the ring ~a minute
// then reads as a queue that won't clear. Just long enough to register the "Done"
// tick, then gone. recentlyEvicted (EVICT_MEMORY_MS) still blocks a stale poll
// from resurrecting the ring after the short evict, so this is safe.
const RESOLVED_LINGER_MS = 2_500;
const EXIT_MS = 360; // exit transition length
// Must exceed ACTIVE_RECENT_MS (60s, lib/actions/agent.ts): the poll returns a
// done run for ~60s after it finishes, so a shorter memory would let a later
// poll resurrect a ring we already evicted while another agent is still running.
const EVICT_MEMORY_MS = 70_000; // don't let a stale poll resurrect a faded ring
const EMPTY_IDS: string[] = [];
const EMPTY_SUMMARY: QueueItem[] = [];

/** Shallow-equal two queue snapshots so a delta-only patch keeps the same ref. */
function sameSummary(a: QueueItem[], b: QueueItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.runId !== y.runId ||
      x.status !== y.status ||
      x.phase !== y.phase ||
      x.title !== y.title ||
      x.clientName !== y.clientName ||
      x.prdSectionsSeen !== y.prdSectionsSeen ||
      x.prdId !== y.prdId ||
      x.startedAt !== y.startedAt ||
      x.finishedAt !== y.finishedAt ||
      x.error !== y.error ||
      x.leaving !== y.leaving
    ) {
      return false;
    }
  }
  return true;
}

interface Store {
  subscribe(listener: () => void): () => void;
  getIds(): string[];
  getSummary(): QueueItem[];
  getRun(runId: string): LiveRun | undefined;
  hasActive(): boolean;
  hydrate(active: ActiveRun[]): void;
  dispose(): void;
  api: AgentRunsApi;
}

function createStore(): Store {
  const runs = new Map<string, LiveRun>();
  const controllers = new Map<string, AbortController>();
  const evictTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const recentlyEvicted = new Map<string, number>();
  const notified = new Set<string>();
  const listeners = new Set<() => void>();
  let idsSnapshot: string[] = EMPTY_IDS;
  let summarySnapshot: QueueItem[] = EMPTY_SUMMARY;
  let seq = 0;

  const emit = () => {
    const ordered = [...runs.values()].sort((a, b) => a.createdSeq - b.createdSeq);
    // Rebuild the id list only when the *set/order* changes, so field-only
    // updates (a delta) don't churn consumers — just the one ring.
    const nextIds = ordered.map((r) => r.runId);
    if (nextIds.length !== idsSnapshot.length || nextIds.some((id, i) => id !== idsSnapshot[i])) {
      idsSnapshot = nextIds;
    }
    // Same idea one level up: the queue chip/popover read a phase/status
    // projection, so a token delta produces an identical snapshot and reuses the
    // old ref (sameSummary) — no queue re-render until a phase or status moves.
    const nextSummary: QueueItem[] = ordered.map((r) => ({
      runId: r.runId,
      kind: r.kind,
      engagementId: r.engagementId,
      projectId: r.projectId,
      prdId: r.prdId,
      clientName: r.clientName,
      title: r.title,
      status: r.status,
      phase: r.phase,
      prdSectionsSeen: r.prdSectionsSeen,
      prdSectionsTotal: r.prdSectionsTotal,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      error: r.error,
      leaving: r.leaving,
    }));
    if (!sameSummary(nextSummary, summarySnapshot)) {
      summarySnapshot = nextSummary;
    }
    for (const l of listeners) l();
  };

  // Immutable per-run update: replace the object so useSyncExternalStore sees a
  // new ref for THIS run and an unchanged ref for every other.
  const patch = (runId: string, next: Partial<LiveRun>) => {
    const cur = runs.get(runId);
    if (!cur) return;
    runs.set(runId, { ...cur, ...next, updatedAt: Date.now() });
    emit();
  };

  // Ping the builder the first time a run reaches a terminal state. A successful
  // finish stays quiet — no page-level toast; the queue chip grows a subtle dot
  // instead (see AgentRunDock) so a finishing run doesn't interrupt. An error
  // still deserves a loud toast, since the builder has to act on it. Only live
  // completions notify — hydrate marks freshly-discovered done runs as
  // already-notified, so a refresh doesn't replay a stale error for a run that
  // finished a minute ago.
  const notifyDone = (runId: string) => {
    if (notified.has(runId)) return;
    const r = runs.get(runId);
    if (!r) return;
    notified.add(runId);
    if (r.status === "error") {
      toast.error(r.kind === "prd" ? "PRD generation didn't finish" : "Agent hit an error", {
        description: r.error ?? `${r.clientName} · ${r.title}`,
      });
    }
  };

  const clearTimer = (runId: string) => {
    const t = evictTimers.get(runId);
    if (t) clearTimeout(t);
    evictTimers.delete(runId);
  };

  const scheduleEvict = (runId: string, linger: number = DONE_LINGER_MS) => {
    clearTimer(runId);
    const t = setTimeout(() => {
      patch(runId, { leaving: true });
      const t2 = setTimeout(() => {
        runs.delete(runId);
        recentlyEvicted.set(runId, Date.now());
        evictTimers.delete(runId);
        emit();
      }, EXIT_MS);
      evictTimers.set(runId, t2);
    }, linger);
    evictTimers.set(runId, t);
  };

  const onEvent = (runId: string, event: Parameters<Parameters<typeof streamAgentTurn>[1]>[0]) => {
    const cur = runs.get(runId);
    if (!cur) return;
    switch (event.type) {
      case "status":
        patch(runId, { status: event.status });
        break;
      case "phase":
        if (event.phase === "reading" || event.phase === "searching" || event.phase === "composing") {
          patch(runId, { phase: event.phase });
        }
        break;
      case "sources":
        patch(runId, { phase: "composing", sources: event.sources });
        break;
      case "delta":
        patch(runId, { phase: "composing", streamingContent: cur.streamingContent + event.text });
        break;
      case "tool":
        patch(runId, {
          status: "running_tool",
          phase: cur.phase === "composing" ? "composing" : "searching",
        });
        break;
      case "widget":
        patch(runId, { widgets: [...cur.widgets, event.widget] });
        break;
      case "final":
        patch(runId, {
          status: "done",
          phase: "done",
          streamingContent: event.content,
          sources: event.sources,
          widgets: event.widgets ?? cur.widgets,
          finalMessageId: event.messageId,
          streaming: false,
          finishedAt: Date.now(),
        });
        notifyDone(runId);
        scheduleEvict(runId);
        break;
      case "proposal":
        patch(runId, {
          status: "awaiting_input",
          phase: "composing",
          streamingContent: event.content,
          sources: event.sources,
          widgets: event.widgets ?? cur.widgets,
          toolCalls: event.toolCalls,
          toolStatus: "proposed",
          finalMessageId: event.messageId,
          streaming: false,
        });
        // No evict — an amber "needs you" ring persists until the builder acts.
        break;
      case "error":
        patch(runId, { status: "error", error: event.error, streaming: false, finishedAt: Date.now() });
        notifyDone(runId);
        scheduleEvict(runId);
        break;
    }
  };

  // PRD runs stream at section granularity over their own route. `section` fills
  // the ring; `content` feeds the live document widget; `done` carries the finished
  // widget + persisted prdId (the "Open PRD" target).
  const onPrdEvent = (runId: string, event: PrdRunEvent) => {
    const cur = runs.get(runId);
    if (!cur) return;
    switch (event.type) {
      case "phase":
        if (event.phase === "reading" || event.phase === "searching" || event.phase === "composing") {
          patch(runId, { phase: event.phase });
        }
        break;
      case "section":
        patch(runId, { phase: "composing", prdSectionsSeen: event.sectionsSeen });
        break;
      case "content":
        patch(runId, { prdPartial: event.partial });
        break;
      case "done":
        patch(runId, {
          status: "done",
          phase: "done",
          prdId: event.prdId,
          prdPartial: event.widget.content,
          prdSectionsSeen: event.widget.sectionsTotal,
          widgets: [event.widget],
          finalMessageId: event.messageId,
          streaming: false,
          finishedAt: Date.now(),
        });
        notifyDone(runId);
        scheduleEvict(runId);
        break;
      case "error":
        patch(runId, { status: "error", error: event.error, streaming: false, finishedAt: Date.now() });
        notifyDone(runId);
        scheduleEvict(runId);
        break;
    }
  };

  const startRun = (args: StartRunArgs) => {
    const existing = runs.get(args.runId);
    if (existing?.streaming) return; // already in flight — dedupe double effects/remounts
    const kind = args.kind ?? "chat";
    clearTimer(args.runId);
    recentlyEvicted.delete(args.runId);
    notified.delete(args.runId);
    runs.set(args.runId, {
      runId: args.runId,
      kind,
      engagementId: args.engagementId,
      projectId: args.projectId ?? null,
      prdId: null,
      clientName: args.clientName,
      title: args.title,
      status: "thinking",
      phase: "reading",
      streamingContent: "",
      sources: [],
      widgets: [],
      prdPartial: null,
      prdSectionsSeen: 0,
      prdSectionsTotal: 22,
      toolCalls: null,
      toolStatus: null,
      finalMessageId: undefined,
      error: null,
      streaming: true,
      detached: false,
      startedAt: existing?.startedAt ?? Date.now(),
      finishedAt: undefined,
      leaving: false,
      createdSeq: existing?.createdSeq ?? seq++,
      updatedAt: Date.now(),
    });
    emit();

    const controller = new AbortController();
    controllers.set(args.runId, controller);
    const streamPromise =
      kind === "prd"
        ? streamPrdRun(args.runId, (event) => onPrdEvent(args.runId, event), controller.signal)
        : streamAgentTurn(
            {
              runId: args.runId,
              message: args.message ?? "",
              page: args.page,
              projectId: args.projectId ?? undefined,
              viewedDocKind: args.viewedDoc?.kind,
              viewedDocId: args.viewedDoc?.id,
              viewedSection: args.viewedSection ?? undefined,
            },
            (event) => onEvent(args.runId, event),
            controller.signal
          );
    void streamPromise.finally(() => {
      controllers.delete(args.runId);
      // Stream ended without a terminal event (abort / dropped connection). The
      // run may still be completing server-side — mark not-streaming and let the
      // poll reconcile the real terminal state.
      const r = runs.get(args.runId);
      if (r?.streaming) patch(args.runId, { streaming: false, detached: true });
    });
  };

  const stopRun = (runId: string) => {
    controllers.get(runId)?.abort();
    controllers.delete(runId);
    const r = runs.get(runId);
    if (r?.streaming) patch(runId, { streaming: false });
  };

  const dismissRun = (runId: string) => {
    const r = runs.get(runId);
    if (!r) return;
    // Only a finished/errored run is dismissable: the turn completes server-side
    // under after(), so there's no cancel for one still in flight — we never yank
    // a running agent out from under itself. recentlyEvicted keeps a mid-flight
    // poll from resurrecting the ring we just cleared.
    if (r.status !== "done" && r.status !== "error") return;
    clearTimer(runId);
    runs.delete(runId);
    recentlyEvicted.set(runId, Date.now());
    notified.add(runId);
    emit();
  };

  // Clear a run parked on the builder (`awaiting_input`) without opening it: cancel
  // its pending proposal server-side and evict the ring now. recentlyEvicted covers
  // the gap until the server flip to `done` ages out of the recency window, so a
  // poll landing mid-cancel can't resurrect the "needs you" ring.
  const cancelRun = (runId: string) => {
    const r = runs.get(runId);
    if (!r || r.status !== "awaiting_input") return;
    clearTimer(runId);
    runs.delete(runId);
    recentlyEvicted.set(runId, Date.now());
    notified.add(runId);
    emit();
    void dismissAgentRun(runId).catch(() => {
      // Best-effort: if the cancel write fails, the worst case is the poll
      // re-adds the run after EVICT_MEMORY_MS — never a fired write, since the
      // proposal only executes on an explicit confirm.
    });
  };

  // The builder acted on a parked proposal INLINE (confirm/reject in the thread).
  // confirmToolCall/rejectToolCall already settled the run to `done` server-side,
  // but this client streamed the proposal, so its copy is stuck `awaiting_input`
  // with no evict timer — and the poll's hydrate leaves a non-streaming,
  // non-detached run to a timer a proposal never scheduled. Settle it here so the
  // ring turns done and fades on the normal linger instead of nagging forever.
  const resolveRun = (runId: string) => {
    const r = runs.get(runId);
    if (!r || r.status !== "awaiting_input") return;
    clearTimer(runId);
    patch(runId, { status: "done", phase: "done", streaming: false, finishedAt: Date.now() });
    notified.add(runId); // acted on inline — the thread already showed the result
    // Short linger: the builder just acted, so don't hold the ring the full
    // catch-it-later window (see RESOLVED_LINGER_MS).
    scheduleEvict(runId, RESOLVED_LINGER_MS);
  };

  const hydrate = (active: ActiveRun[]) => {
    const now = Date.now();
    for (const ar of active) {
      // Don't resurrect a ring that just faded out.
      const evictedAt = recentlyEvicted.get(ar.id);
      if (evictedAt && now - evictedAt < EVICT_MEMORY_MS) continue;

      const cur = runs.get(ar.id);
      const phase: RunPhase =
        ar.phase === "searching" || ar.phase === "composing" || ar.phase === "done"
          ? ar.phase
          : cur?.phase ?? "reading";
      const terminal = ar.status === "done" || ar.status === "error";

      if (!cur) {
        runs.set(ar.id, {
          runId: ar.id,
          kind: ar.kind,
          engagementId: ar.engagementId,
          projectId: ar.projectId,
          prdId: ar.prdId,
          clientName: ar.clientName,
          title: ar.title,
          status: ar.status,
          phase,
          streamingContent: "",
          sources: [],
          widgets: [],
          prdPartial: null,
          prdSectionsSeen: 0,
          prdSectionsTotal: 22,
          toolCalls: null,
          toolStatus: null,
          error: null,
          streaming: false,
          detached: true,
          startedAt: Date.parse(ar.createdAt) || now,
          finishedAt: terminal ? now : undefined,
          leaving: false,
          createdSeq: seq++,
          updatedAt: now,
        });
        emit();
        if (terminal) {
          // Discovered already-done via the poll (e.g. a refresh) — evict it, but
          // stay silent so reloading doesn't replay a stale "finished" toast.
          notified.add(ar.id);
          scheduleEvict(ar.id);
        }
        continue;
      }

      if (cur.streaming) {
        // Live SSE is the fresher source — take only the label from the poll.
        if (cur.title !== ar.title || cur.clientName !== ar.clientName) {
          patch(ar.id, { title: ar.title, clientName: ar.clientName });
        }
        continue;
      }

      if (cur.detached) {
        patch(ar.id, { status: ar.status, phase, title: ar.title, clientName: ar.clientName, prdId: ar.prdId });
        if (terminal && !cur.finishedAt && !evictTimers.has(ar.id)) {
          // A run this tab started but whose SSE dropped — the poll caught it
          // finishing, so it's a live completion the builder was waiting on.
          patch(ar.id, { finishedAt: now });
          notifyDone(ar.id);
          scheduleEvict(ar.id);
        }
      } else if (cur.status === "awaiting_input" && terminal && !evictTimers.has(ar.id)) {
        // A proposal this client streamed, then confirmed/rejected in ANOTHER tab:
        // the server settled it, but our copy is stuck `awaiting_input` with no
        // evict timer (a proposal schedules none, and resolveRun only fires in the
        // acting tab). Reconcile from the poll so the "needs you" ring can't nag on.
        patch(ar.id, { status: ar.status, phase, finishedAt: now });
        notified.add(ar.id); // silent — the acting tab already saw the result
        scheduleEvict(ar.id);
      }
      // else: a run this client streamed to a terminal — its own evict timer owns it.
    }
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getIds: () => idsSnapshot,
    getSummary: () => summarySnapshot,
    getRun: (runId) => runs.get(runId),
    hasActive: () =>
      [...runs.values()].some(
        (r) => r.streaming || r.status === "thinking" || r.status === "running_tool" || r.status === "awaiting_input"
      ),
    hydrate,
    dispose() {
      for (const c of controllers.values()) c.abort();
      controllers.clear();
      for (const t of evictTimers.values()) clearTimeout(t);
      evictTimers.clear();
      listeners.clear();
    },
    api: { startRun, stopRun, dismissRun, cancelRun, resolveRun, getRun: (runId) => runs.get(runId) },
  };
}

const StoreContext = React.createContext<Store | null>(null);

function useStore(hook: string): Store {
  const store = React.useContext(StoreContext);
  if (!store) throw new Error(`${hook} must be used within <AgentRunsProvider>`);
  return store;
}

export function useAgentRunsApi(): AgentRunsApi {
  return useStore("useAgentRunsApi").api;
}

/** The runs API when inside a provider, else null. For components that render in
    both trees — the global search bar sits inside the provider for builders but
    outside it for operators — so the throwing hook can't be used unconditionally.
    Builders get the real api and can queue runs; operators get null and never do. */
export function useAgentRunsApiOptional(): AgentRunsApi | null {
  return React.useContext(StoreContext)?.api ?? null;
}

export function useAgentRunsList(): string[] {
  const store = useStore("useAgentRunsList");
  return React.useSyncExternalStore(store.subscribe, store.getIds, store.getIds);
}

/** The queue's phase/status projection — one entry per run, in creation order.
    Memoized in the store, so this only re-renders on a phase/status/membership
    change, never on a streaming token. */
export function useAgentRunsSummary(): QueueItem[] {
  const store = useStore("useAgentRunsSummary");
  return React.useSyncExternalStore(store.subscribe, store.getSummary, store.getSummary);
}

export function useAgentRun(runId: string | null | undefined): LiveRun | undefined {
  const store = useStore("useAgentRun");
  const get = React.useCallback(
    () => (runId ? store.getRun(runId) : undefined),
    [store, runId]
  );
  return React.useSyncExternalStore(store.subscribe, get, get);
}

export function AgentRunsProvider({ children }: { children: React.ReactNode }) {
  // One stable store instance for the provider's lifetime.
  const [store] = React.useState(createStore);

  // Rehydrate on mount (covers a full refresh / a run started in another tab),
  // then poll as a backstop — but only while something is actually in flight, so
  // an idle dock costs nothing.
  React.useEffect(() => {
    let alive = true;
    let interval: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      try {
        const active = await getActiveRuns();
        if (alive) store.hydrate(active);
      } catch {
        // non-fatal — palette-close survival still works without the poll
      }
    };

    const stopInterval = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };
    const ensureInterval = () => {
      if (interval) return;
      interval = setInterval(async () => {
        await poll();
        if (!store.hasActive()) stopInterval();
      }, 1500);
    };

    void poll();
    // Whenever a run becomes active, make sure the poll loop is running.
    const unsub = store.subscribe(() => {
      if (store.hasActive()) ensureInterval();
    });

    return () => {
      alive = false;
      stopInterval();
      unsub();
      store.dispose();
    };
  }, [store]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}
