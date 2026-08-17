"use client";

import { useState, useTransition } from "react";
import { Sparkles, GitCommit, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";
import { acceptReleaseGap, dismissReleaseGap } from "@/lib/actions/release-gaps";
import { TaskTypeBadge, TaskTags } from "@/components/task-type-badge";
import type { ReleaseGap, Task } from "@/lib/types";

/**
 * A proposed task for work that shipped in this push with nothing tracking it.
 *
 * Sized and laid out as one more card in the push's grid — same title, clamped
 * description, priority dot, type badge and tags a real task card carries, and
 * a gap already holds every one of those fields. What it must never do is *pass*
 * for a real task: the amber rail, the tint and the dashed border say this one
 * doesn't exist yet, and the two buttons are the only way it ever will.
 *
 * Collapsed it shows the headline evidence — the first commit. Clicking the
 * description opens the rest: every commit, and the files they touched.
 */

interface ReleaseGapCardProps {
  gap: ReleaseGap;
  /** The push this hangs under, for the toast copy. */
  pushLabel: string;
  /** The row the accept created, handed to the board so it renders as a real
   *  card in this push straight away — see `acceptedTasks` in StagingBoard. */
  onAccepted?: (task: Task) => void;
}

export function ReleaseGapCard({ gap, pushLabel, onAccepted }: ReleaseGapCardProps) {
  const [, startTransition] = useTransition();

  const [title, setTitle] = useState(gap.title);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(gap.title);
  const [expanded, setExpanded] = useState(false);
  // Resolved cards leave on the click, not on the write. Both answers are the
  // builder's own decision and neither can be argued with by the server, so the
  // only thing waiting would buy is a disabled card — same posture as the
  // commit-match cards on the build board. A failure puts it back.
  const [resolved, setResolved] = useState(false);

  if (resolved) return null;

  function commitTitle() {
    const next = draftTitle.trim();
    if (next.length >= 3) setTitle(next);
    setEditing(false);
  }

  // No router.refresh() in either path: both actions revalidate /b/staging, and
  // a server action that revalidates the current route already ships the fresh
  // tree back with its response. Asking again is a second full render of this
  // page — the most expensive board in the app — for nothing.
  function doAccept() {
    setResolved(true);
    startTransition(async () => {
      const res = await acceptReleaseGap(gap.id, { title });
      if ("error" in res) {
        toast.error(res.error);
        setResolved(false);
        return;
      }
      // Paint the task in this push now rather than when the revalidated board
      // arrives — the write is done, and the row is the real one.
      onAccepted?.(res.task);
      toast.success(`Added “${title}” to ${pushLabel}`);
    });
  }

  function doDismiss() {
    setResolved(true);
    startTransition(async () => {
      const res = await dismissReleaseGap(gap.id);
      if ("error" in res) {
        toast.error(res.error);
        setResolved(false);
      }
    });
  }

  // Collapsed, the first commit is the evidence — the rest is depth for someone
  // who wants it, not something to pay grid height for by default.
  const commits = expanded ? gap.evidence : gap.evidence.slice(0, 1);
  const hiddenCommits = gap.evidence.length - commits.length;

  return (
    <div className="krowe-gap">
      <div className="krowe-gap-rail" aria-hidden="true" />

      <div className="krowe-gap-kicker">
        <span className="badge">
          <Sparkles width={11} height={11} strokeWidth={2.4} />
        </span>
        <span className="h">Not tracked</span>
        {!editing && (
          <button
            type="button"
            className="krowe-gap-iconbtn"
            aria-label={`Rename ${title}`}
            onClick={() => {
              setDraftTitle(title);
              setEditing(true);
            }}
          >
            <Pencil width={12} height={12} />
          </button>
        )}
      </div>

      {editing ? (
        <div className="krowe-gap-titleedit">
          <input
            aria-label="Task title"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            maxLength={300}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitTitle();
              } else if (e.key === "Escape") {
                setDraftTitle(title);
                setEditing(false);
              }
            }}
          />
          <button
            type="button"
            className="krowe-gap-iconbtn"
            aria-label="Save title"
            disabled={draftTitle.trim().length < 3}
            onClick={commitTitle}
          >
            <Check width={13} height={13} />
          </button>
          <button
            type="button"
            className="krowe-gap-iconbtn"
            aria-label="Cancel editing the title"
            onClick={() => {
              setDraftTitle(title);
              setEditing(false);
            }}
          >
            <X width={13} height={13} />
          </button>
        </div>
      ) : (
        <p className="krowe-gap-title">{title}</p>
      )}

      <button
        type="button"
        className={`krowe-gap-desc${expanded ? " is-open" : ""}`}
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        {gap.description}
      </button>

      {commits.length > 0 && (
        <ul className="krowe-gap-commits">
          {commits.map((c) => (
            <li key={c.sha}>
              <GitCommit width={11} height={11} strokeWidth={2} aria-hidden="true" />
              {c.url ? (
                <a href={c.url} target="_blank" rel="noreferrer">
                  <span className="sha">{c.sha.slice(0, 7)}</span>
                  <span className="msg">{c.subject}</span>
                </a>
              ) : (
                <span>
                  <span className="sha">{c.sha.slice(0, 7)}</span>
                  <span className="msg">{c.subject}</span>
                </span>
              )}
            </li>
          ))}
          {hiddenCommits > 0 && (
            <li className="more">
              +{hiddenCommits} more commit{hiddenCommits === 1 ? "" : "s"}
            </li>
          )}
        </ul>
      )}

      {expanded && gap.files.length > 0 && (
        <p className="krowe-gap-files">{gap.files.join(" · ")}</p>
      )}

      {/* The same meta row a task card carries — a gap already holds the
          priority, type and tags the task would be created with. */}
      <div className="krowe-gap-meta">
        <span className={`krowe-prio-dot ${gap.priority}`}>
          <span className="d" />
        </span>
        <TaskTypeBadge type={gap.type} />
        <TaskTags tags={gap.tags} />
      </div>

      <div className="krowe-gap-foot">
        <button type="button" className="deny" onClick={doDismiss}>
          Not needed
        </button>
        <button
          type="button"
          className="confirm"
          disabled={title.trim().length < 3}
          onClick={doAccept}
        >
          <Check width={12} height={12} strokeWidth={2.4} />
          Create task
        </button>
      </div>
    </div>
  );
}
