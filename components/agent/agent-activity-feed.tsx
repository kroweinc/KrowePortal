"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ChevronDown,
  FileText,
  MessageSquare,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";

import { Ember } from "@/components/design-atoms";
import {
  useAgentRunsApi,
  useAgentRunsSummary,
} from "@/components/agent/agent-runs-provider";
import { deleteAgentRun, listAllAgentRuns } from "@/lib/actions/agent";
import { isActiveStatus, mergeFeed, type FeedRow } from "@/lib/agent/feed";
import {
  clientSwatch,
  dayBucket,
  formatElapsed,
  runHref,
  stepLabel,
} from "@/lib/agent/run-presentation";
import { relativeTime } from "@/lib/utils";
import type { ActiveRun } from "@/lib/agent/types";
import type { HubEngagement } from "@/components/agent/agent-hub";

// The cross-client activity feed: durable history (server) reconciled with the
// provider's live runs, filtered and grouped by day (Today over Earlier). A live
// run carries an elapsed timer, a pulsing "Running" badge, and a mini progress bar;
// finished runs carry a relative time, a Done/Error badge, and a delete.

type KindFilter = "all" | "chat" | "prd";
type StatusFilter = "all" | "active" | "done" | "error";

/** Each run's engine → the row's leading icon + the mono kind label. Our runs record
    the engine (chat | prd), not the named launch agent, so task-manager / client-
    summary runs read as "Context Chat" — they are chat-engine conversations. */
const KIND: Record<"chat" | "prd", { icon: LucideIcon; label: string }> = {
  chat: { icon: MessageSquare, label: "Context Chat" },
  prd: { icon: FileText, label: "PRD Writer" },
};

/** A once-a-second clock, running only while a live run is in flight. Doubles as the
    "now" the day buckets read (the day rarely turns over mid-session). */
function useNowTick(active: boolean): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/** The status pill on a row — the design's three states plus the real "awaiting your
    go-ahead" case chat runs can enter. */
function StatusBadge({ status }: { status: FeedRow["status"] }) {
  if (status === "awaiting_input") {
    return (
      <span className="krowe-af-badge" data-kind="await">
        <span className="krowe-af-bd" />
        Needs you
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="krowe-af-badge" data-kind="error">
        <span className="krowe-af-bd" />
        Error
      </span>
    );
  }
  if (status === "done") {
    return (
      <span className="krowe-af-badge" data-kind="done">
        <span className="krowe-af-bd" />
        Done
      </span>
    );
  }
  return (
    <span className="krowe-af-badge" data-kind="active">
      <span className="krowe-af-bd" />
      Running
    </span>
  );
}

export function AgentActivityFeed({
  engagements,
  initialHistory,
}: {
  engagements: HubEngagement[];
  initialHistory: ActiveRun[];
}) {
  const router = useRouter();
  const live = useAgentRunsSummary();
  const { dismissRun, cancelRun } = useAgentRunsApi();

  const [history, setHistory] = React.useState<ActiveRun[]>(initialHistory);
  const [clientId, setClientId] = React.useState<string>("all");
  const [kind, setKind] = React.useState<KindFilter>("all");
  const [status, setStatus] = React.useState<StatusFilter>("all");

  const running = live.some((l) => isActiveStatus(l.status));
  const now = useNowTick(running);

  // Pull finished runs into durable history the moment the live active-set changes,
  // so a completed run survives its ~55s live linger/eviction without a gap.
  const activeKey = live
    .filter((l) => isActiveStatus(l.status))
    .map((l) => l.runId)
    .sort()
    .join(",");
  const prevActiveKey = React.useRef(activeKey);
  React.useEffect(() => {
    if (activeKey === prevActiveKey.current) return;
    prevActiveKey.current = activeKey;
    void listAllAgentRuns()
      .then(setHistory)
      .catch(() => {
        /* non-fatal — the live layer still covers in-flight runs */
      });
  }, [activeKey]);

  const rows = React.useMemo(() => mergeFeed(history, live), [history, live]);

  // Client + type scope drives the status counts; status then narrows what's shown.
  const scoped = rows.filter((r) => {
    if (clientId !== "all" && r.engagementId !== clientId) return false;
    if (kind !== "all" && r.kind !== kind) return false;
    return true;
  });
  const counts = {
    active: scoped.filter((r) => isActiveStatus(r.status)).length,
    done: scoped.filter((r) => r.status === "done").length,
    error: scoped.filter((r) => r.status === "error").length,
  };
  const filtered = scoped.filter((r) => {
    if (status === "active") return isActiveStatus(r.status);
    if (status === "done") return r.status === "done";
    if (status === "error") return r.status === "error";
    return true;
  });

  // Group the sorted rows by day (Today over Earlier); rows keep the merged
  // active-first order inside each bucket, so the running run leads Today.
  const buckets: { label: "Today" | "Earlier"; rows: FeedRow[] }[] = [];
  for (const r of filtered) {
    const label = dayBucket(r.sortAt, now);
    let bucket = buckets.find((b) => b.label === label);
    if (!bucket) {
      bucket = { label, rows: [] };
      buckets.push(bucket);
    }
    bucket.rows.push(r);
  }
  buckets.sort((a, b) => (a.label === "Today" ? -1 : 1) - (b.label === "Today" ? -1 : 1));

  function onDelete(runId: string) {
    // Optimistic: drop it locally, then persist. A failed delete resurfaces on the
    // next active-set refetch — never a silent loss of a live run.
    setHistory((h) => h.filter((r) => r.id !== runId));
    void deleteAgentRun(runId).catch(() => {});
  }

  function whenLabel(r: FeedRow): string {
    if (r.live) return formatElapsed(r.startedAt, r.finishedAt ?? now);
    return relativeTime(r.updatedAt);
  }

  /** The trailing dismiss/cancel/delete affordance — dismiss a lingering finished
      live row, cancel an awaiting one, or delete a history row. */
  function rowAction(r: FeedRow): React.ReactNode {
    if (r.live) {
      if (r.status === "done" || r.status === "error") {
        return (
          <button
            type="button"
            className="krowe-af-del"
            onClick={() => dismissRun(r.runId)}
            aria-label="Clear from list"
            title="Clear"
          >
            <Trash2 size={15} />
          </button>
        );
      }
      if (r.status === "awaiting_input") {
        return (
          <button
            type="button"
            className="krowe-af-del"
            onClick={() => cancelRun(r.runId)}
            aria-label="Cancel request"
            title="Cancel this request"
          >
            <X size={15} />
          </button>
        );
      }
      return null; // still working — no server-side cancel; the row still opens
    }
    return (
      <button
        type="button"
        className="krowe-af-del"
        onClick={() => onDelete(r.runId)}
        aria-label="Delete run"
        title="Delete"
      >
        <Trash2 size={15} />
      </button>
    );
  }

  function renderRow(r: FeedRow) {
    const k = KIND[r.kind];
    const KindIcon = k.icon;
    const swatch = clientSwatch(r.clientName);
    const isRunning = r.status === "thinking" || r.status === "running_tool";
    return (
      <div key={r.runId} className="krowe-af-run" data-status={r.status}>
        <button
          type="button"
          className="krowe-af-run-main"
          onClick={() => router.push(runHref(r))}
          aria-label={`Open ${r.clientName} — ${r.title}`}
        >
          <span className="krowe-af-run-ic">
            <KindIcon size={19} />
          </span>
          <span className="krowe-af-run-body">
            <span className="krowe-af-run-top">
              <span className="krowe-af-ctag">
                <span className="krowe-af-swatch" data-tone={swatch.tone}>
                  {swatch.init}
                </span>
                {r.clientName}
              </span>
              <span className="krowe-af-dotsep" />
              <span className="krowe-af-kind">{k.label}</span>
            </span>
            <span className="krowe-af-run-title">{r.title}</span>
            <span className="krowe-af-run-note">
              {isRunning && (
                <span className="krowe-af-miniprog" aria-hidden="true">
                  <span />
                </span>
              )}
              {stepLabel(r)}
            </span>
          </span>
          <span className="krowe-af-run-aside">
            <StatusBadge status={r.status} />
            <span className="krowe-af-run-time">{whenLabel(r)}</span>
            <span className="krowe-af-run-open" aria-hidden="true">
              {r.status === "error" ? "Retry" : "Open"}
              <ArrowRight size={13} />
            </span>
          </span>
        </button>
        {rowAction(r)}
      </div>
    );
  }

  return (
    <section className="krowe-af">
      <div className="krowe-ah-sec">Activity</div>

      <div className="krowe-af-toolbar">
        <div className="krowe-af-filters">
          {engagements.length > 0 && (
            <div className="krowe-fdrop">
              <select
                aria-label="Filter by client"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              >
                <option value="all">All clients</option>
                {engagements.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={15} className="krowe-fdrop-caret" />
            </div>
          )}
          <div className="krowe-fdrop">
            <select
              aria-label="Filter by type"
              value={kind}
              onChange={(e) => setKind(e.target.value as KindFilter)}
            >
              <option value="all">All types</option>
              <option value="chat">Context Chat</option>
              <option value="prd">PRD Writer</option>
            </select>
            <ChevronDown size={15} className="krowe-fdrop-caret" />
          </div>
        </div>

        <div className="krowe-seg" role="tablist" aria-label="Filter by status">
          {(
            [
              ["all", "All", null],
              ["active", "Active", counts.active],
              ["done", "Done", counts.done],
              ["error", "Error", counts.error],
            ] as const
          ).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={status === value}
              className={status === value ? "on" : ""}
              onClick={() => setStatus(value)}
            >
              {label}
              {count !== null && <span className="krowe-seg-cnt">{count}</span>}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="krowe-af-empty">
          <Ember size={38} />
          <div className="krowe-af-empty-t">
            {rows.length === 0 ? "No agents have run yet" : "Nothing here yet"}
          </div>
          <div className="krowe-af-empty-s">
            {rows.length === 0
              ? "Start one above — every run lands here."
              : "No runs match this filter."}
          </div>
        </div>
      ) : (
        buckets.map((bucket) => (
          <div key={bucket.label} className="krowe-af-daygroup">
            <div className="krowe-af-day">{bucket.label}</div>
            <div className="krowe-af-runs">{bucket.rows.map(renderRow)}</div>
          </div>
        ))
      )}
    </section>
  );
}
