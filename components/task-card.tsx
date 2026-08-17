"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, CheckCheck, CornerUpLeft, Pin, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { updateTaskStatus } from "@/lib/actions/tasks";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useRequestDone } from "@/components/done-deliverable-provider";
import { useRequestApproval } from "@/components/approval-deliverable-provider";
import { useTaskMenu } from "@/components/task-menu";
import { ContextMenu } from "@/components/ui/context-menu";
import { ApprovalPill } from "@/components/approval-pill";
import { DeliveryChips, PriorityBars, StateGlyph } from "@/components/design-atoms";
import { TaskTypeBadge, TaskTags } from "@/components/task-type-badge";
import { SubmitterAvatar } from "@/components/submitter-avatar";
import {
  submitterName,
  submitterInitials,
  getTaskAdvance,
  getActiveChangeRequest,
  isAwaitingApproval,
  relativeTime,
} from "@/lib/utils";
import type { PendingCommitMatch } from "@/lib/actions/get-commit-task-matches";
import type { Task, Role, TaskStatus } from "@/lib/types";

interface TaskCardProps {
  task: Task;
  role: Role;
  engagementTitle?: string;
  onSelect?: (task: Task) => void;
  // Optimistic plain-status mover supplied by the board so a move paints
  // instantly. When absent (e.g. the staging board) the card calls the server
  // action directly. Done/approval moves always go through their dialogs.
  onStatusMove?: (taskId: string, status: TaskStatus) => void;
  onDragStart?: (task: Task) => void;
  onDragEnd?: () => void;
  // Multi-select: when onToggleSelect is provided the card grows a checkbox
  // (revealed on hover, and pinned open once any card is selected). `selected`
  // is this card's state; `selectionMode` = at least one card is selected.
  selected?: boolean;
  selectionMode?: boolean;
  onToggleSelect?: (task: Task) => void;
  // A commit that looks like it finished this task. Below the auto-apply
  // threshold the card strikes the title through and asks the builder to
  // confirm; at or above it the scan already moved the task and the card reports
  // that instead, with Not done as a full undo.
  commitMatch?: PendingCommitMatch;
  onConfirmMatch?: (task: Task) => void;
  onDismissMatch?: (task: Task) => void;
}

export function TaskCard({
  task,
  role,
  onSelect,
  onStatusMove,
  onDragStart,
  onDragEnd,
  selected = false,
  selectionMode = false,
  onToggleSelect,
  commitMatch,
  onConfirmMatch,
  onDismissMatch,
}: TaskCardProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  const requestDone = useRequestDone();
  const requestApproval = useRequestApproval();
  const advance = getTaskAdvance(task);
  const changeRequest = getActiveChangeRequest(task);
  // Builder-only — completion authority stays with whoever wrote the code. The
  // done check that used to live here has moved server-side: an auto-applied
  // match belongs on a done card (it's reporting the move), an ordinary
  // suggestion never reaches one. See getPendingCommitMatches.
  const showMatch = !!commitMatch && role === "builder";
  const autoApplied = !!commitMatch?.autoApplied;
  const taskMenu = useTaskMenu({
    task,
    role,
    onOpen: onSelect ? () => onSelect(task) : undefined,
    onStatusMove,
    requestDone,
    requestApproval,
    selected,
    onToggleSelect: onToggleSelect ? () => onToggleSelect(task) : undefined,
  });

  async function handleAdvance() {
    if (!advance) return;
    if (advance.kind === "done") {
      // Prefer the board's optimistic mover so the card flips to Done instantly;
      // fall back to the dialog directly where there's no board (staging board).
      if (onStatusMove) onStatusMove(task.id, "done");
      else requestDone({ task });
    } else if (advance.kind === "approval") {
      requestApproval({ task });
    } else if (onStatusMove) {
      onStatusMove(task.id, advance.status);
    } else {
      await updateTaskStatus(task.id, advance.status);
    }
  }

  return (
    <>
    <div
      // `selectable` marks the cards that render a checkbox — it cross-fades
      // over the state glyph, so it costs the card no gutter of its own.
      className={`krowe-card priority-${task.priority} status-${task.status} ${onToggleSelect ? "selectable" : ""} ${isAwaitingApproval(task) ? "approval-pending" : ""} ${showMatch && !autoApplied ? "likely-done" : ""} ${autoApplied ? "auto-done" : ""} ${isDragging ? "dragging" : ""} ${selectionMode ? "selecting" : ""} ${selected ? "selected" : ""}`}
      draggable
      onDragStart={(e) => {
        setIsDragging(true);
        e.dataTransfer.setData("taskId", task.id);
        e.dataTransfer.effectAllowed = "move";
        // Drag the card, not the link under the cursor. A grab that lands on the
        // title <a> would otherwise hand the browser its own ghost — the URL
        // chip — so we snapshot a clone of the card and hold it at the exact
        // point it was picked up. The clone lives offscreen for one frame,
        // which is all the browser needs to rasterize it.
        const rect = e.currentTarget.getBoundingClientRect();
        const ghost = e.currentTarget.cloneNode(true) as HTMLElement;
        ghost.classList.remove("dragging");
        ghost.classList.add("krowe-card-ghost");
        ghost.style.width = `${rect.width}px`;
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, e.clientX - rect.left, e.clientY - rect.top);
        requestAnimationFrame(() => ghost.remove());
        onDragStart?.(task);
      }}
      onDragEnd={() => {
        setIsDragging(false);
        onDragEnd?.();
      }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button,a")) return;
        onSelect?.(task);
      }}
      onContextMenu={taskMenu.menu.openAtEvent}
    >
      <div className="krowe-card-srow">
        {onToggleSelect && (
          <button
            type="button"
            className={`krowe-card-select ${selected ? "on" : ""}`}
            role="checkbox"
            aria-checked={selected}
            aria-label={selected ? "Deselect task" : "Select task"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect(task);
            }}
          >
            {selected && <Check width={12} height={12} strokeWidth={3} />}
          </button>
        )}
        <StateGlyph status={task.status} />
        <Link
          href={`/${role === "operator" ? "o" : "b"}/tasks/${task.id}`}
          className="krowe-card-title"
          draggable={false}
          onClick={(e) => {
            if (!onSelect) return;
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            onSelect(task);
          }}
        >
          {task.title}
        </Link>
        <div className="krowe-card-srow-end">
          {task.pinned_at && (
            <span className="krowe-card-pin" title="Pinned to top" aria-label="Pinned to top">
              <Pin width={13} height={13} strokeWidth={2.2} />
            </span>
          )}
          <ApprovalPill task={task} role={role} />
        </div>
      </div>

      {task.description && (
        <p className="krowe-card-desc">{task.description}</p>
      )}

      {changeRequest && (
        <div className="krowe-card-changes">
          <div className="krowe-card-changes-head">
            <span className="badge">
              <RotateCcw width={13} height={13} strokeWidth={2.2} />
            </span>
            <span className="h">Changes requested</span>
            <span className="t">{relativeTime(changeRequest.created_at)}</span>
          </div>
          <div className="krowe-card-changes-body">
            {changeRequest.metadata?.note && (
              <p className="krowe-card-changes-note">&ldquo;{changeRequest.metadata.note}&rdquo;</p>
            )}
            <div className="krowe-card-changes-foot">
              <span className="av" aria-hidden="true">
                {submitterInitials({
                  display_name: changeRequest.actor?.display_name ?? null,
                  role: "operator",
                })}
              </span>
              <span className="who">{changeRequest.actor?.display_name ?? "Operator"}</span>
              <span className="spacer" />
              {role === "builder" && advance?.kind === "approval" && (
                <button
                  className="resolve"
                  onClick={(e) => {
                    e.stopPropagation();
                    requestApproval({ task });
                  }}
                >
                  <CornerUpLeft width={13} height={13} strokeWidth={2} />
                  Resubmit
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showMatch && commitMatch && (
        <div className={`krowe-card-shipped ${autoApplied ? "auto" : ""}`}>
          <div className="krowe-card-shipped-head">
            <span className="badge">
              <CheckCheck width={13} height={13} strokeWidth={2.2} />
            </span>
            <span className="h">
              {autoApplied ? "Marked done automatically" : "Looks shipped"}
            </span>
            {commitMatch.committedAt && (
              <span className="t">{relativeTime(commitMatch.committedAt)}</span>
            )}
          </div>
          <div className="krowe-card-shipped-body">
            {commitMatch.url ? (
              <a
                className="krowe-card-shipped-commit"
                href={commitMatch.url}
                target="_blank"
                rel="noreferrer"
                draggable={false}
                onClick={(e) => e.stopPropagation()}
              >
                <span className="sha">{commitMatch.shortSha}</span>
                <span className="msg">{commitMatch.subject}</span>
              </a>
            ) : (
              <span className="krowe-card-shipped-commit">
                <span className="sha">{commitMatch.shortSha}</span>
                <span className="msg">{commitMatch.subject}</span>
              </span>
            )}
            {commitMatch.reason && (
              <p className="krowe-card-shipped-reason">{commitMatch.reason}</p>
            )}
            <div className="krowe-card-shipped-foot">
              <button
                type="button"
                className="deny"
                onClick={(e) => {
                  e.stopPropagation();
                  onDismissMatch?.(task);
                }}
              >
                Not done
              </button>
              <button
                type="button"
                className="confirm"
                onClick={(e) => {
                  e.stopPropagation();
                  onConfirmMatch?.(task);
                }}
              >
                <Check width={13} height={13} strokeWidth={2.4} />
                {autoApplied ? "Keep" : "Confirm done"}
              </button>
            </div>
          </div>
        </div>
      )}

      <DeliveryChips task={task} />

      <div className="krowe-card-smeta">
        <PriorityBars priority={task.priority} />
        <TaskTypeBadge type={task.type} />
        <TaskTags tags={task.tags} />
        <span className="krowe-card-spacer" />
        {/* Signature and actions share one grid cell so the hover cross-fade
            never reflows the meta line — see .krowe-card-endcap. */}
        <div className="krowe-card-endcap">
          <div className="krowe-card-signature">
            <span className="krowe-card-date">
              {new Date(task.created_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              })}
            </span>
            <span className="krowe-card-sep" />
            <span className="krowe-card-submitter" title={submitterName(task.creator)}>
              <SubmitterAvatar creator={task.creator} />
            </span>
          </div>
          <div className="krowe-card-actions">
            {role === "builder" && advance && (
              <button
                className="krowe-advance-btn"
                onClick={(e) => { e.stopPropagation(); handleAdvance(); }}
              >
                <span style={{ fontFamily: "var(--font-mono)" }}>→</span>
                {advance.label}
              </button>
            )}
            <button
              className="krowe-iconbtn danger"
              title="Delete task"
              onClick={async (e) => {
                e.stopPropagation();
                if (
                  !(await confirm({
                    title: `Delete “${task.title}”?`,
                    description: "This permanently removes the task. This can’t be undone.",
                    confirmText: "Delete task",
                    cancelText: "Cancel",
                    icon: Trash2,
                    tone: "danger",
                  }))
                )
                  return;
                import("@/lib/actions/tasks")
                  .then(({ deleteTask }) => deleteTask(task.id))
                  .then((res) => {
                    if (res && typeof res === "object" && "error" in res && res.error) {
                      toast.error(res.error as string);
                    }
                  })
                  .catch(() => toast.error("Couldn't delete the task. Please try again."));
              }}
            >
              <Trash2 width={14} height={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
    <ContextMenu state={taskMenu.menu.state} items={taskMenu.items} onClose={taskMenu.menu.close} />
    {taskMenu.dialogs}
    {confirmDialog}
    </>
  );
}
