"use client";

import * as React from "react";

import { ProgressRing } from "@/components/ui/progress-ring";
import {
  metaLabel,
  ringFill,
  stepLabel,
  type RunView,
} from "@/lib/agent/run-presentation";

// One agent-run row, shared by the topbar queue dock and the Agents Hub feed. The
// `.krowe-aq-job*` markup is verbatim from the dock's old inline QueueRow, so the
// dock is visually unchanged; the feed opts into the leading ring (showRing) that
// the dock's rows never had (the dock stacks its rings on the chip instead).
//
// The trailing `actions` slot is caller-owned: the dock passes its dismiss/cancel/
// open-hint; the feed passes open/retry/delete.

export interface AgentRunRowItem extends RunView {
  runId: string;
  clientName: string;
  title: string;
}

export function AgentRunRow({
  item,
  showRing = false,
  whenLabel,
  onOpen,
  actions,
}: {
  item: AgentRunRowItem;
  /** Leading determinate ring (feed rows). The dock omits it — its rings live on
      the chip. */
  showRing?: boolean;
  /** Right-edge time label — elapsed for a live run, relative for history. */
  whenLabel: string;
  onOpen: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <div className="krowe-aq-job" data-status={item.status}>
      {showRing && (
        // The ProgressRing rotates its SVG children −90°, so nothing is rendered
        // inside it — the status color comes from the [data-status] wrapper.
        <span className="krowe-aq-job-ring" data-status={item.status}>
          <ProgressRing value={ringFill(item)} size={22} strokeWidth={3} />
        </span>
      )}
      <button
        type="button"
        className="krowe-aq-job-main"
        onClick={onOpen}
        aria-label={`Open ${item.clientName} — ${item.title}`}
      >
        <span className="krowe-aq-job-tx">
          <span className="krowe-aq-job-client">{item.clientName}</span>
          <span className="krowe-aq-job-title">{item.title}</span>
          <span className="krowe-aq-job-step">{stepLabel(item)}</span>
        </span>
        <span className="krowe-aq-job-meta">
          <span className="krowe-aq-job-pct">{metaLabel(item)}</span>
          <span className="krowe-aq-job-el">{whenLabel}</span>
        </span>
      </button>
      {actions}
    </div>
  );
}
