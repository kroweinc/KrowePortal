import type { HTMLAttributes, ReactNode } from "react";
import { Info } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { GRANOLA_HISTORY_DAYS, isBeyondGranolaHistory } from "@/lib/granola/format";
import {
  splitTranscript,
  locateQuotes,
  splitOnQuote,
  type TranscriptLine,
} from "@/lib/granola/transcript-view";
import type { GranolaMeetingDetail } from "@/lib/actions/granola-meetings";

/**
 * The parts of a Granola call that read identically wherever the call is shown:
 * its own page (/b/meetings/[id], server-rendered) and the task sheet's inline
 * panel (client). Pure render throughout and no "use client" of its own — the
 * importing tree decides which side it lands on.
 *
 * Shared rather than copied because the subtle half is here: the quote anchors,
 * the <mark> split, and the heading demotion all have to agree with the quote a
 * task was extracted against. Two copies would drift.
 */

/**
 * How far to push a summary's own headings down so its shallowest one lands at
 * h3 — directly under a section's h2, with nothing skipped.
 *
 * A fixed h1→h3 map isn't enough: Granola writes summaries that open at "##"
 * just as often as "#", and mapping that to h4 under an h2 skips a level and
 * breaks the sequential-headings rule as surely as emitting a second h1 would.
 */
function headingShift(markdown: string): number {
  let shallowest = 7;
  for (const m of markdown.matchAll(/^(#{1,6})\s/gm)) {
    shallowest = Math.min(shallowest, m[1].length);
  }
  return shallowest === 7 ? 0 : 3 - shallowest;
}

function demotedHeading(level: number, shift: number) {
  const Tag = `h${Math.min(6, Math.max(3, level + shift))}` as "h3" | "h4" | "h5" | "h6";
  function Demoted({
    node: _node,
    ...props
  }: { node?: unknown } & HTMLAttributes<HTMLHeadingElement>) {
    return <Tag {...props} />;
  }
  return Demoted;
}

/** Granola's own notes. .md-content styles h1-h3, so .krowe-mtg-md restates the
    sizes for the deeper levels the demotion can produce. */
export function MeetingSummary({ markdown }: { markdown: string }) {
  const shift = headingShift(markdown);
  return (
    <div className="md-content krowe-mtg-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: demotedHeading(1, shift),
          h2: demotedHeading(2, shift),
          h3: demotedHeading(3, shift),
          h4: demotedHeading(4, shift),
          h5: demotedHeading(5, shift),
          h6: demotedHeading(6, shift),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

/** Participants arrive as one unstructured string — its only other consumer is
    the extraction prompt, which wants it raw. Parse defensively and show
    nothing rather than a placeholder when it yields nothing. */
export function parseParticipants(raw: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(/[\n,;]+/)) {
    const name = part.trim();
    if (name) seen.add(name);
  }
  return Array.from(seen).slice(0, 12);
}

/** Several different truths, one sentence each — "no transcript" alone would
    leave the builder guessing which problem they have, and only some of them
    are worth waiting on. */
export function absentTranscriptCopy(meeting: GranolaMeetingDetail): string {
  // First, ahead of every other branch: past the window there is nothing left
  // to fetch, whatever the last attempt recorded — and a pre-0088 import that
  // never captured would otherwise promise a read that can only 404.
  if (isBeyondGranolaHistory(meeting.callAt)) {
    return `Granola only serves the last ${GRANOLA_HISTORY_DAYS} days of calls, so this one can no longer be fetched — what's here is what was saved at import.`;
  }
  if (meeting.capturePending) return "Reading this call from Granola — reload in a moment.";
  switch (meeting.transcriptStatus) {
    case "plan_gated":
      return "Granola shares transcripts on paid workspaces only, so this call came through with its summary alone.";
    case "not_ready":
      return "Granola hadn't finished this transcript when the call was imported.";
    case "failed":
      return "Granola couldn't be reached for this call, so only what was saved at import is here.";
    default:
      return "This call came through with no transcript text.";
  }
}

/**
 * Whether asking Granola again could change the answer.
 *
 * Only the two "later" outcomes: a transcript Granola hadn't finished, and a
 * fetch that couldn't reach it. `plan_gated` is a billing fact no button here
 * can move, a pending capture is already running, and a call past the 30-day
 * window is gone for good — offering a retry beside any of them would be a
 * control that can't do what it says.
 */
export function canRetrySnapshot(meeting: GranolaMeetingDetail): boolean {
  if (meeting.capturePending) return false;
  if (isBeyondGranolaHistory(meeting.callAt)) return false;
  return meeting.transcriptStatus === "failed" || meeting.transcriptStatus === "not_ready";
}

/** Why the call has no transcript, and — when asking again could help — the
    caller's retry control under it. */
export function TranscriptAbsent({
  meeting,
  retry,
}: {
  meeting: GranolaMeetingDetail;
  retry?: ReactNode;
}) {
  return (
    <div className="krowe-mtg-note">
      <Info size={17} strokeWidth={2} aria-hidden="true" />
      <div className="body">
        <p>{absentTranscriptCopy(meeting)}</p>
        {retry}
      </div>
    </div>
  );
}

export interface MeetingLayout {
  lines: TranscriptLine[];
  /** Line index → the tasks quoting it. Several tasks can quote one line. */
  anchors: Map<number, string[]>;
  quoteByTask: Map<string, string | null>;
  /** The tasks whose quote actually landed on a line — the rest have a quote
      but nothing to point at, and must not offer a jump. */
  anchoredTasks: Set<string>;
}

export function buildMeetingLayout(meeting: GranolaMeetingDetail): MeetingLayout {
  const lines = meeting.transcript ? splitTranscript(meeting.transcript) : [];
  const anchors = locateQuotes(
    lines,
    meeting.tasks.map((t) => ({ taskId: t.id, quote: t.sourceQuote }))
  );
  return {
    lines,
    anchors,
    quoteByTask: new Map(meeting.tasks.map((t) => [t.id, t.sourceQuote])),
    anchoredTasks: new Set(Array.from(anchors.values()).flat()),
  };
}

/** An inclusive slice of the transcript, in original line indexes. */
export interface TranscriptRange {
  from: number;
  to: number;
}

const WINDOW_LEAD = 4;
const WINDOW_TRAIL = 8;

/**
 * The slice a preview opens on: the run-up to the line this task was drafted
 * from, and what was said just after. With nothing anchored there's no better
 * guess than the top of the call.
 */
export function windowAround(layout: MeetingLayout, taskId: string | null): TranscriptRange {
  const last = layout.lines.length - 1;
  let center = -1;
  if (taskId) {
    for (const [index, owners] of layout.anchors) {
      if (owners.includes(taskId)) {
        center = index;
        break;
      }
    }
  }
  if (center === -1) return { from: 0, to: Math.min(WINDOW_LEAD + WINDOW_TRAIL, last) };
  return {
    from: Math.max(0, center - WINDOW_LEAD),
    to: Math.min(last, center + WINDOW_TRAIL),
  };
}

/**
 * The call itself: a mono speaker rail and the line, with every line a task
 * came from shaded and the quoted words marked.
 */
export function TranscriptLines({
  layout,
  fromTaskId,
  range,
}: {
  layout: MeetingLayout;
  fromTaskId: string | null;
  /** Render only this slice, keeping the original indexes so the anchors stay
      pointed at the right lines. Omit to render the whole call. */
  range?: TranscriptRange | null;
}) {
  const { lines, anchors, quoteByTask } = layout;
  return (
    <div className="krowe-mtg-panel krowe-mtg-transcript">
      {lines.map((line, i) => {
        if (range && (i < range.from || i > range.to)) return null;
        const owners = anchors.get(i);
        const arrived = !!fromTaskId && !!owners?.includes(fromTaskId);
        const parts = owners
          ? splitOnQuote(line.text, quoteByTask.get(owners[0]) ?? null)
          : null;
        return (
          <p
            key={i}
            // Focusable only when it's a jump target, so QuoteFocus can move
            // focus here without adding every line to the tab order.
            tabIndex={owners ? -1 : undefined}
            className={
              "krowe-mtg-line" +
              (line.speaker === "Me" ? " me" : "") +
              (owners ? " is-quoted" : "") +
              (arrived ? " is-arrived" : "")
            }
          >
            {owners?.map((id) => (
              <span key={id} id={`q-${id}`} className="krowe-mtg-anchor" aria-hidden="true" />
            ))}
            <span className="who">{line.speaker ?? ""}</span>
            <span className="said">
              {owners && <span className="sr-only">A task came from this line. </span>}
              {parts ? (
                <>
                  {parts.before}
                  <mark>{parts.hit}</mark>
                  {parts.after}
                </>
              ) : (
                line.text
              )}
            </span>
          </p>
        );
      })}
    </div>
  );
}
