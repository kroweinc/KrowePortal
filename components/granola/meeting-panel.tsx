"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AudioLines, ChevronRight, Info } from "lucide-react";
import { Ember } from "@/components/design-atoms";
import {
  MeetingSummary,
  TranscriptAbsent,
  TranscriptLines,
  buildMeetingLayout,
  canRetrySnapshot,
  parseParticipants,
  windowAround,
} from "@/components/granola/meeting-parts";
import { MeetingRetry } from "@/components/granola/meeting-retry";
import { formatCallDate } from "@/lib/granola/format";
import { STATUS_LABELS } from "@/lib/utils";
import type { GranolaMeetingDetail } from "@/lib/actions/granola-meetings";

/**
 * The call, read inside the task sheet. Following "From meeting" lands here
 * first; /b/meetings/[id] — the same call, whole — stays one click away in the
 * sheet's sub-bar.
 *
 * A preview, not a copy of the page. Two things are deliberately different:
 * the transcript opens windowed on the line this task was drafted from (a
 * two-thousand-line call has no business hydrating into a 600px rail), and
 * nothing steals scroll on mount — the summary is the point of a preview, and
 * the quoted line is already in view under it.
 */
export function MeetingPanel({
  meeting,
  fromTaskId,
  onOpenTask,
  openableTaskIds,
  onRefreshed,
}: {
  meeting: GranolaMeetingDetail;
  fromTaskId: string;
  /** Swap the sheet to a sibling task from this call, for the tasks the board
      behind the sheet is showing. Everything else falls back to a link. */
  onOpenTask?: (id: string) => void;
  openableTaskIds?: string[];
  /** Re-read the call after a retry — the sheet holds the fetched copy, so a
      route refresh wouldn't reach it. */
  onRefreshed?: () => void;
}) {
  const layout = useMemo(() => buildMeetingLayout(meeting), [meeting]);
  const [showAll, setShowAll] = useState(false);

  const callDate = formatCallDate(meeting.callAt);
  const people = parseParticipants(meeting.participants);
  const taskCount = meeting.tasks.length;
  const lineCount = layout.lines.length;
  const range = showAll ? null : windowAround(layout, fromTaskId);
  const shown = range ? range.to - range.from + 1 : lineCount;
  const hidden = lineCount - shown;

  return (
    <div className="krowe-mtg-inline">
      <header className="krowe-mtg-hero">
        <span className="krowe-mtg-hero-ic" aria-hidden="true">
          <AudioLines size={17} strokeWidth={1.9} />
        </span>
        <div className="krowe-mtg-hero-body">
          <h1 className="krowe-mtg-title">{meeting.title ?? "Untitled call"}</h1>
          <div className="krowe-mtg-meta">
            {callDate && (
              <>
                <span className="mono">{callDate}</span>
                <span className="dot" aria-hidden="true" />
              </>
            )}
            <span>
              {taskCount} {taskCount === 1 ? "task" : "tasks"} from this call
            </span>
          </div>
          {people.length > 0 && (
            <>
              <p className="krowe-mtg-people-cap" id="mtg-panel-people">
                Participants
              </p>
              <ul className="krowe-mtg-people" aria-labelledby="mtg-panel-people">
                {people.map((p) => (
                  <li key={p} className="krowe-mtg-person">
                    {p}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </header>

      <div className="krowe-mtg-sections">
        <section className="krowe-mtg-sec" aria-labelledby="mtg-panel-summary">
          <div className="krowe-mtg-sec-h">
            <h2 id="mtg-panel-summary">Summary</h2>
            <span className="ct">Granola&rsquo;s notes</span>
          </div>
          <div className="krowe-mtg-panel">
            {meeting.summary ? (
              <MeetingSummary markdown={meeting.summary} />
            ) : (
              <p className="krowe-mtg-blank">
                {meeting.capturePending
                  ? "Reading this call from Granola — reload in a moment."
                  : "No summary came through with this call."}
              </p>
            )}
          </div>
        </section>

        <section className="krowe-mtg-sec" aria-labelledby="mtg-panel-transcript">
          <div className="krowe-mtg-sec-h">
            <h2 id="mtg-panel-transcript">Transcript</h2>
            {lineCount > 0 && (
              <span className="ct">
                {hidden > 0 ? `${shown} of ${lineCount} lines` : `${lineCount} lines`}
              </span>
            )}
          </div>
          {lineCount === 0 ? (
            <TranscriptAbsent
              meeting={meeting}
              retry={
                canRetrySnapshot(meeting) && (
                  <MeetingRetry importId={meeting.id} onRefreshed={onRefreshed} />
                )
              }
            />
          ) : (
            <>
              <TranscriptLines layout={layout} fromTaskId={fromTaskId} range={range} />
              {hidden > 0 && (
                <button
                  type="button"
                  className="krowe-mtg-more"
                  onClick={() => setShowAll(true)}
                >
                  Read the rest of the call ({hidden} more {hidden === 1 ? "line" : "lines"})
                </button>
              )}
            </>
          )}
        </section>

        <section className="krowe-mtg-sec" aria-labelledby="mtg-panel-tasks">
          <div className="krowe-mtg-sec-h">
            <h2 id="mtg-panel-tasks">Tasks from this call</h2>
            <span className="ct">{taskCount}</span>
          </div>
          {taskCount === 0 ? (
            <div className="krowe-mtg-note">
              <Info size={17} strokeWidth={2} aria-hidden="true" />
              <p>
                No tasks are linked to this call — they were deleted, or the call was
                imported before tasks recorded where they came from.
              </p>
            </div>
          ) : (
            <ul className="krowe-mtg-tasks">
              {meeting.tasks.map((task) => {
                const isCurrent = task.id === fromTaskId;
                const row = (
                  <>
                    <Ember size={12} />
                    <span className="t">{task.title}</span>
                    {isCurrent && <span className="from">This task</span>}
                    <span className={`krowe-chip krowe-chip-status ${task.status}`}>
                      {STATUS_LABELS[task.status]}
                    </span>
                    {!isCurrent && (
                      <ChevronRight size={15} strokeWidth={2} className="go" aria-hidden="true" />
                    )}
                  </>
                );
                return (
                  <li
                    key={task.id}
                    className={"krowe-mtg-task" + (isCurrent ? " is-from" : "")}
                  >
                    {isCurrent ? (
                      <div className="krowe-mtg-task-link is-current" aria-current="true">
                        {row}
                      </div>
                    ) : onOpenTask && openableTaskIds?.includes(task.id) ? (
                      // Already on screen behind the sheet — swap the sheet to it
                      // rather than navigating the board out from under it.
                      <button
                        type="button"
                        className="krowe-mtg-task-link"
                        onClick={() => onOpenTask(task.id)}
                      >
                        {row}
                      </button>
                    ) : (
                      <Link href={`/b?task=${task.id}`} className="krowe-mtg-task-link">
                        {row}
                      </Link>
                    )}
                    {task.sourceQuote && (
                      <div className="krowe-gr-quote">
                        <div className="q">&ldquo;{task.sourceQuote}&rdquo;</div>
                        <div className="qm">
                          <AudioLines size={11} strokeWidth={2} aria-hidden="true" />
                          from the call
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/** Held while the call is being read. Shaped like the panel above — hero, then
    two blocks — so nothing jumps when the real thing lands. */
export function MeetingPanelSkeleton() {
  return (
    <div className="krowe-mtg-inline krowe-mtg-load" aria-busy="true">
      <span className="sr-only">Loading the call</span>
      <div className="krowe-skel" style={{ height: 44, width: "72%" }} />
      <div className="krowe-skel" style={{ height: 13, width: "40%" }} />
      <div className="krowe-skel" style={{ height: 132 }} />
      <div className="krowe-skel" style={{ height: 96 }} />
    </div>
  );
}
