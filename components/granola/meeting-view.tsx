import Link from "next/link";
import { ArrowLeft, AudioLines, ChevronRight, Info } from "lucide-react";
import { Ember } from "@/components/design-atoms";
import { QuoteFocus } from "@/components/granola/quote-focus";
import {
  MeetingSummary,
  TranscriptAbsent,
  TranscriptLines,
  buildMeetingLayout,
  canRetrySnapshot,
  parseParticipants,
} from "@/components/granola/meeting-parts";
import { MeetingRetry } from "@/components/granola/meeting-retry";
import { formatCallDate } from "@/lib/granola/format";
import { STATUS_LABELS } from "@/lib/utils";
import type { GranolaMeetingDetail } from "@/lib/actions/granola-meetings";

/**
 * The call a set of tasks came out of. Granola has no shareable URL, so this
 * page IS the destination — everything on it is the snapshot taken at import
 * (migration 0088), not a live read.
 *
 * The full read. Its preview — the same call inside the task sheet — is
 * MeetingPanel, and the pieces they share live in meeting-parts.tsx.
 *
 * Server component throughout; the only client JS is QuoteFocus.
 */
export function MeetingView({
  meeting,
  fromTaskId,
}: {
  meeting: GranolaMeetingDetail;
  fromTaskId: string | null;
}) {
  const callDate = formatCallDate(meeting.callAt);
  const people = parseParticipants(meeting.participants);
  const layout = buildMeetingLayout(meeting);
  const { lines, anchoredTasks } = layout;
  const taskCount = meeting.tasks.length;

  return (
    <main className="krowe-page">
      <div className="krowe-page-inner">
        <Link href={`/b/engagements/${meeting.engagementId}`} className="krowe-mtg-back">
          <ArrowLeft size={15} strokeWidth={1.75} aria-hidden="true" />
          {meeting.engagementTitle ?? "Client"}
        </Link>

        <header className="krowe-mtg-hero">
          <span className="krowe-mtg-hero-ic" aria-hidden="true">
            <AudioLines size={20} strokeWidth={1.9} />
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
                <p className="krowe-mtg-people-cap" id="mtg-people">
                  Participants
                </p>
                <ul className="krowe-mtg-people" aria-labelledby="mtg-people">
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
          <section className="krowe-mtg-sec" aria-labelledby="mtg-summary">
            <div className="krowe-mtg-sec-h">
              <h2 id="mtg-summary">Summary</h2>
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

          <section className="krowe-mtg-sec" aria-labelledby="mtg-transcript">
            <div className="krowe-mtg-sec-h">
              <h2 id="mtg-transcript">Transcript</h2>
              {lines.length > 0 && (
                <span className="ct">
                  {lines.length} {lines.length === 1 ? "line" : "lines"}
                </span>
              )}
            </div>
            {lines.length === 0 ? (
              <TranscriptAbsent
                meeting={meeting}
                retry={canRetrySnapshot(meeting) && <MeetingRetry importId={meeting.id} />}
              />
            ) : (
              <TranscriptLines layout={layout} fromTaskId={fromTaskId} />
            )}
            <QuoteFocus
              targetId={fromTaskId && anchoredTasks.has(fromTaskId) ? `q-${fromTaskId}` : null}
            />
          </section>

          <section className="krowe-mtg-sec" aria-labelledby="mtg-tasks">
            <div className="krowe-mtg-sec-h">
              <h2 id="mtg-tasks">Tasks from this call</h2>
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
                {meeting.tasks.map((task) => (
                  <li
                    key={task.id}
                    className={"krowe-mtg-task" + (task.id === fromTaskId ? " is-from" : "")}
                  >
                    {/* Opens the real detail sheet on the board rather than the
                        legacy /b/tasks/[id] page. */}
                    <Link
                      href={`/b?task=${task.id}`}
                      className="krowe-mtg-task-link"
                      aria-current={task.id === fromTaskId ? "true" : undefined}
                    >
                      <Ember size={12} />
                      <span className="t">{task.title}</span>
                      {task.id === fromTaskId && <span className="from">You came from here</span>}
                      <span className={`krowe-chip krowe-chip-status ${task.status}`}>
                        {STATUS_LABELS[task.status]}
                      </span>
                      <ChevronRight size={15} strokeWidth={2} className="go" aria-hidden="true" />
                    </Link>
                    {task.sourceQuote && (
                      <div className="krowe-gr-quote">
                        <div className="q">&ldquo;{task.sourceQuote}&rdquo;</div>
                        <div className="qm">
                          <AudioLines size={11} strokeWidth={2} aria-hidden="true" />
                          {anchoredTasks.has(task.id) ? (
                            <a className="krowe-mtg-jump" href={`#q-${task.id}`}>
                              See it in the transcript
                            </a>
                          ) : (
                            "from the call"
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
