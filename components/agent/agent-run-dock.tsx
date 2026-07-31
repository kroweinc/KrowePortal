"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronDown, ChevronLeft, X } from "lucide-react";

import { ProgressRing } from "@/components/ui/progress-ring";
import { AgentThread, ToolIcon, describeToolCall } from "@/components/agent/agent-thread";
import { PrdRunPanel } from "@/components/agent/prd-run-panel";
import { AgentRunRow } from "@/components/agent/agent-run-row";
import {
  useAgentRun,
  useAgentRunsApi,
  useAgentRunsSummary,
  type QueueItem,
} from "@/components/agent/agent-runs-provider";
import { confirmToolCall, getAgentRun, rejectToolCall } from "@/lib/actions/agent";
import { publishDocEdit } from "@/lib/agent/doc-events";
import type { AgentToolCall } from "@/lib/agent/types";
import { RANK, formatElapsed, isTerminal, ringFill } from "@/lib/agent/run-presentation";

// The parallel-agents queue — Direction A of the "Agent Queue" design. Instead of
// one anonymous spinner per run scattered across the topbar, every in-flight (or
// just-finished) agent collapses into ONE calm chip: a stack of determinate
// progress rings + a count. Click it to open the queue — each agent named, with
// its live step, progress, elapsed time, and a way to act. Clicking a row opens
// that run's conversation in place (no full-page route), and a finished row can
// be cleared. Driven entirely by AgentRunsProvider's memoized queue summary, so a
// streaming token never re-renders the chip — only a phase/status change does.
//
// `variant` is kept for the mount site's API (nav.tsx passes "inline"); the chip
// is compact enough to live in the topbar either way.

type DockVariant = "inline" | "float";

// Row derivations (ringFill/stepLabel/metaLabel/formatElapsed/RANK/isTerminal) +
// the row markup now live in lib/agent/run-presentation.ts + <AgentRunRow>, shared
// verbatim with the Agents Hub feed so the two surfaces can't drift.

/** A once-a-second clock, fresh from mount. Lives in the popover subtree, which
    mounts only when the queue is open — so it ticks solely while visible, and its
    initial value is never stale. */
function useSecondTick(): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function AgentRunDock({ variant = "inline" }: { variant?: DockVariant }) {
  const items = useAgentRunsSummary();
  // Empty → render nothing. Keeping the stateful queue in its own component means
  // its open/focus state is destroyed when the last agent leaves, so a later run
  // starts with the popover closed — no stale-open bookkeeping needed.
  if (items.length === 0) return null;
  return <AgentQueue items={items} variant={variant} />;
}

function AgentQueue({ items, variant }: { items: QueueItem[]; variant: DockVariant }) {
  const { dismissRun } = useAgentRunsApi();
  const [open, setOpen] = React.useState(false);
  // A snapshot (not just an id) of the run whose conversation is open — so its
  // header survives the run being evicted from the queue underneath it.
  const [focus, setFocus] = React.useState<QueueItem | null>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  // Close on outside click / Escape, like the search dropdown. Escape steps back
  // out of a focused conversation first, then closes the popover.
  React.useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFocus(null);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setFocus((f) => {
        if (f) return null;
        setOpen(false);
        return null;
      });
    }
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Which finished runs the builder hasn't acknowledged yet. A successful finish
  // no longer pops a toast — it grows a quiet dot on the chip instead, cleared the
  // moment the queue is opened. State (not a ref) so the dot paints reactively;
  // it resets for free when the queue drains and this component unmounts.
  const [seen, setSeen] = React.useState<Set<string>>(() => new Set());
  const doneIds = items.filter((i) => i.status === "done").map((i) => i.runId);
  const doneKey = doneIds.join(",");
  const hasUnseenDone = doneIds.some((id) => !seen.has(id));
  React.useEffect(() => {
    if (!open || !hasUnseenDone) return;
    setSeen((prev) => {
      const next = new Set(prev);
      for (const id of doneIds) next.add(id);
      return next;
    });
    // doneKey stands in for doneIds (a fresh array each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hasUnseenDone, doneKey]);

  const sorted = [...items].sort((a, b) => RANK[a.status] - RANK[b.status]);
  const working = items.filter((i) => i.status === "thinking" || i.status === "running_tool").length;
  const awaiting = items.filter((i) => i.status === "awaiting_input").length;
  const active = working + awaiting;

  const count = active > 0 ? active : items.length;
  const sub = awaiting > 0 ? "needs you" : working > 0 ? "working" : "all done";

  return (
    <div className="krowe-aq" data-variant={variant} ref={wrapRef} role="status" aria-label="Running agents">
      <button
        type="button"
        className="krowe-aq-chip"
        data-attention={awaiting > 0 || undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${count} agent${count === 1 ? "" : "s"} — ${sub}`}
        onClick={() => setOpen((o) => !o)}
      >
        {hasUnseenDone && <span className="krowe-aq-chip-dot" aria-hidden="true" />}
        <span className="krowe-aq-chip-stack" aria-hidden="true">
          {sorted.slice(0, 3).map((item) => (
            <span key={item.runId} className="krowe-aq-chip-ring" data-status={item.status}>
              <ProgressRing value={ringFill(item)} size={18} strokeWidth={3} />
            </span>
          ))}
        </span>
        <span className="krowe-aq-chip-lbl">
          <span className="t">
            {count} agent{count === 1 ? "" : "s"}
          </span>
          <span className="s">{sub}</span>
        </span>
        <ChevronDown size={16} className="krowe-aq-chip-car" aria-hidden="true" />
      </button>

      {open && (
        <div className="krowe-aq-pop" data-view={focus ? "thread" : "queue"} role="dialog" aria-label="Agent queue">
          {focus ? (
            <ThreadPanel
              focus={focus}
              onBack={() => setFocus(null)}
              onClose={() => {
                setOpen(false);
                setFocus(null);
              }}
            />
          ) : (
            <QueueList items={sorted} onOpen={setFocus} onDismiss={dismissRun} />
          )}
        </div>
      )}
    </div>
  );
}

function QueueList({
  items,
  onOpen,
  onDismiss,
}: {
  items: QueueItem[];
  onOpen: (item: QueueItem) => void;
  onDismiss: (runId: string) => void;
}) {
  const now = useSecondTick();
  return (
    <>
      <div className="krowe-aq-body">
        {items.map((item) =>
          // A run parked on the builder gets its Approve / Cancel inline, right in
          // the queue — no need to open the thread to act. Everything else is the
          // plain row.
          item.status === "awaiting_input" ? (
            <ApprovalRow key={item.runId} item={item} now={now} onOpen={() => onOpen(item)} />
          ) : (
            <QueueRow
              key={item.runId}
              item={item}
              now={now}
              onOpen={() => onOpen(item)}
              onDismiss={() => onDismiss(item.runId)}
            />
          )
        )}
      </div>

      <div className="krowe-aq-foot">
        <Link href="/b/agent" className="krowe-aq-foot-link">
          View all
        </Link>
      </div>
    </>
  );
}

const QueueRow = React.memo(function QueueRow({
  item,
  now,
  onOpen,
  onDismiss,
}: {
  item: QueueItem;
  now: number;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const terminal = isTerminal(item.status);
  const end = item.finishedAt ?? now;

  return (
    <AgentRunRow
      item={item}
      whenLabel={formatElapsed(item.startedAt, end)}
      onOpen={onOpen}
      actions={
        /* A finished run clears now instead of waiting on its linger timer. A
           still-working run has no server-side cancel, so its trailing glyph is
           just an "opens in place" hint (the whole row is the button). Runs parked
           on the builder are handled by <ApprovalRow>, never here. */
        terminal ? (
          <button
            type="button"
            className="krowe-aq-job-x"
            onClick={onDismiss}
            aria-label="Clear from queue"
            title="Clear"
          >
            <X size={14} />
          </button>
        ) : (
          <span className="krowe-aq-job-open" aria-hidden="true">
            <ArrowUpRight size={14} />
          </span>
        )
      }
    />
  );
});

/**
 * A run parked `awaiting_input`, with its proposed action(s) and Approve / Cancel
 * surfaced right in the queue popover — so the builder can act without opening the
 * thread. The proposal comes from the live run when this tab streamed it; a run
 * hydrated from the poll (another tab / a refresh) has no local tool calls, so we
 * fetch the parked proposal once. Confirming/rejecting settles the run server-side
 * exactly like the thread's confirm gate, then resolveRun fades the "needs you"
 * ring on the normal linger. The whole top row still opens the full thread.
 */
const ApprovalRow = React.memo(function ApprovalRow({
  item,
  now,
  onOpen,
}: {
  item: QueueItem;
  now: number;
  onOpen: () => void;
}) {
  const { resolveRun } = useAgentRunsApi();
  const run = useAgentRun(item.runId);

  // The live run carries the proposal when this tab streamed it; otherwise fetch it
  // once. `haveLive` wins so a streamed proposal never triggers a needless fetch.
  const liveMsgId = run?.finalMessageId;
  const liveCalls = run?.toolCalls;
  const haveLive = !!liveMsgId && !!liveCalls?.length;
  const [fetched, setFetched] = React.useState<{ messageId: string; toolCalls: AgentToolCall[] } | null>(null);

  React.useEffect(() => {
    if (haveLive || fetched) return;
    let alive = true;
    void (async () => {
      const res = await getAgentRun(item.runId);
      if (!alive || "error" in res) return;
      const pending = res.messages.find((m) => m.toolStatus === "proposed" && m.toolCalls?.length);
      if (pending?.toolCalls?.length) setFetched({ messageId: pending.id, toolCalls: pending.toolCalls });
    })();
    return () => {
      alive = false;
    };
  }, [haveLive, fetched, item.runId]);

  const messageId = haveLive ? liveMsgId! : fetched?.messageId ?? null;
  const toolCalls = haveLive ? liveCalls! : fetched?.toolCalls ?? null;

  const [busy, setBusy] = React.useState<null | "confirm" | "reject">(null);
  const [err, setErr] = React.useState<string | null>(null);

  async function onConfirm() {
    if (!messageId || busy) return;
    setErr(null);
    setBusy("confirm");
    const res = await confirmToolCall(messageId);
    if ("error" in res) {
      setErr(res.error);
      setBusy(null);
      return;
    }
    // Reflect any document edit live in an open view (no reload), then settle the
    // ring — the row re-renders as a plain "Done" row on the next summary.
    for (const edit of res.docEdits) publishDocEdit(edit);
    resolveRun(item.runId);
  }

  async function onReject() {
    if (!messageId || busy) return;
    setErr(null);
    setBusy("reject");
    const res = await rejectToolCall(messageId);
    if ("error" in res) {
      setErr(res.error);
      setBusy(null);
      return;
    }
    resolveRun(item.runId);
  }

  return (
    <div className="krowe-aq-ask" data-status="awaiting_input">
      <AgentRunRow
        item={item}
        whenLabel={formatElapsed(item.startedAt, item.finishedAt ?? now)}
        onOpen={onOpen}
        actions={
          <span className="krowe-aq-job-open" aria-hidden="true">
            <ArrowUpRight size={14} />
          </span>
        }
      />
      <div className="krowe-aq-ask-strip">
        {toolCalls ? (
          <>
            <div className="krowe-aq-ask-list">
              {toolCalls.map((tc, i) => (
                <div key={i} className="krowe-aq-ask-item">
                  <span className="krowe-aq-ask-ic">
                    <ToolIcon name={tc.name} />
                  </span>
                  <span className="krowe-aq-ask-desc">{describeToolCall(tc)}</span>
                </div>
              ))}
            </div>
            {err && (
              <div className="krowe-aq-ask-err" role="alert">
                {err}
              </div>
            )}
            <div className="krowe-aq-ask-actions">
              <button
                type="button"
                className="krowe-agent-btn ghost"
                onClick={() => void onReject()}
                disabled={!!busy}
              >
                {busy === "reject" ? "Cancelling…" : "Cancel"}
              </button>
              <button
                type="button"
                className="krowe-agent-btn primary"
                onClick={() => void onConfirm()}
                disabled={!!busy}
              >
                {busy === "confirm" ? "Approving…" : "Approve"}
              </button>
            </div>
          </>
        ) : (
          <div className="krowe-aq-ask-load">Loading the request…</div>
        )}
      </div>
    </div>
  );
});

function ThreadPanel({
  focus,
  onBack,
  onClose,
}: {
  focus: QueueItem;
  onBack: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="krowe-aq-thread-head">
        <button type="button" className="krowe-aq-thread-btn" onClick={onBack} aria-label="Back to queue" title="Back">
          <ChevronLeft size={16} />
        </button>
        <span className="krowe-aq-thread-client">{focus.clientName}</span>
        <span className="krowe-aq-thread-title">{focus.title}</span>
        <button type="button" className="krowe-aq-thread-btn" onClick={onClose} aria-label="Close" title="Close">
          <X size={15} />
        </button>
      </div>

      {/* A PRD run has no chat input — render the assembling/finished document. Chat
          runs get the full conversation + confirm gate in place (the same palette
          host the queue hands off to): it hides its own empty state, bounds its
          scroll, and drops the "open full workspace" nudge. */}
      {focus.kind === "prd" ? (
        <PrdRunPanel focus={focus} />
      ) : (
        <AgentThread
          engagementId={focus.engagementId ?? ""}
          clientName={focus.clientName}
          initialRunId={focus.runId}
          variant="palette"
          autoFocus={false}
        />
      )}
    </>
  );
}
