import { PHASE_FILL, type RunPhase } from "@/components/agent/agent-runs-provider";
import type { AgentRunStatus } from "@/lib/agent/types";

// Pure presentation helpers for a single agent-run row, extracted from the topbar
// dock so the dock AND the Agents Hub feed paint identical rows from one source of
// truth (no drift between the two surfaces). No React, no hooks — just derivations
// over a run's status/phase.

/**
 * The minimal shape these helpers read — satisfied by BOTH the live QueueItem (the
 * topbar dock) and the merged FeedRow (the hub feed), so a value from either
 * surface can be handed straight in.
 */
export interface RunView {
  kind: "chat" | "prd";
  status: AgentRunStatus;
  phase: RunPhase;
  prdSectionsSeen: number;
  prdSectionsTotal: number;
  error?: string | null;
  startedAt: number;
  finishedAt?: number;
}

export const isTerminal = (s: AgentRunStatus): boolean => s === "done" || s === "error";

// Surface order: what needs the builder first, what's finished last. Stable sort
// keeps same-rank rows in creation order so nothing jitters mid-turn.
export const RANK: Record<AgentRunStatus, number> = {
  awaiting_input: 0,
  thinking: 1,
  running_tool: 1,
  error: 2,
  done: 3,
  idle: 4,
};

/** How full a run's ring paints — its real phase fill, or a complete ring once it's
    terminal (the status color then reads it as done / errored). A live PRD run fills
    honestly per closed section (0.25→~0.96 across ~22 sections); a detached one (no
    live section count) falls back to phase fill. */
export function ringFill(item: RunView): number {
  if (isTerminal(item.status)) return 1;
  if (item.kind === "prd" && item.prdSectionsSeen > 0) {
    return Math.min(0.96, 0.25 + 0.7 * (item.prdSectionsSeen / item.prdSectionsTotal));
  }
  return PHASE_FILL[item.phase];
}

/** The "what it's doing right now" line — derived from the run's real phase and
    status, never a fabricated timeline. */
export function stepLabel(item: RunView): string {
  if (item.status === "awaiting_input") return "Waiting for your go‑ahead";
  if (item.status === "error") return item.error?.trim() || "Hit a snag — open to see";
  if (item.status === "done") return item.kind === "prd" ? "PRD ready — open to read" : "Done — open to read";
  if (item.kind === "prd") {
    return item.phase === "reading"
      ? "Reading your notes & context"
      : `Drafting your PRD · ${item.prdSectionsSeen}/${item.prdSectionsTotal}`;
  }
  switch (item.phase) {
    case "reading":
      return "Reading this client's context";
    case "searching":
      return "Searching tasks & documents";
    case "composing":
      return "Composing the answer";
    default:
      return "Getting started";
  }
}

/** Right-edge status word / percent for a row (the percent tracks the ring). */
export function metaLabel(item: RunView): string {
  if (item.status === "awaiting_input") return "Needs you";
  if (item.status === "done") return "Done";
  if (item.status === "error") return "Error";
  return `${Math.round(ringFill(item) * 100)}%`;
}

export function formatElapsed(startedAt: number, end: number): string {
  const secs = Math.max(0, Math.floor((end - startedAt) / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

/** The three warm swatch tones behind a client chip in the feed — mirrors the
    design's ink / clay / slate. Picked deterministically per client so a given
    client always reads the same color across sessions. */
export type SwatchTone = "ink" | "clay" | "slate";
const SWATCH_TONES: SwatchTone[] = ["ink", "clay", "slate"];

/** A stable {initials, tone} for a client name — the 16px avatar swatch in each
    run row. Initials are the first letters of the first two words (or the first
    two letters of a single word); the tone is a name-hash so it never jitters. */
export function clientSwatch(name: string): { init: string; tone: SwatchTone } {
  const clean = (name || "Client").trim();
  const words = clean.split(/\s+/).filter(Boolean);
  const init =
    words.length >= 2
      ? (words[0][0] + words[1][0]).toUpperCase()
      : clean.slice(0, 2).toUpperCase();
  let hash = 0;
  for (let i = 0; i < clean.length; i++) hash = (hash * 31 + clean.charCodeAt(i)) >>> 0;
  return { init, tone: SWATCH_TONES[hash % SWATCH_TONES.length] };
}

/** Which day bucket a run's timestamp lands in — the feed groups rows under these
    labels ("Today" over "Earlier"), newest bucket first. `now` is passed so the
    caller owns the clock. */
export function dayBucket(ms: number, now: number): "Today" | "Earlier" {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return ms >= start.getTime() ? "Today" : "Earlier";
}

/** Where a run's row opens to. Chat → its full workspace. PRD → straight to the
    finished document when we know it, else the run route (which redirects prd→doc or
    its project). Mirrors app/b/agent/[runId]/page.tsx. */
export function runHref(r: {
  runId: string;
  kind: "chat" | "prd";
  prdId?: string | null;
  projectId?: string | null;
}): string {
  if (r.kind === "prd" && r.prdId && r.projectId) {
    return `/b/projects/${r.projectId}/prd/${r.prdId}`;
  }
  return `/b/agent/${r.runId}`;
}
