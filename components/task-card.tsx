"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarDays, Check, CornerUpLeft, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { updateTaskStatus } from "@/lib/actions/tasks";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useRequestDone } from "@/components/done-deliverable-provider";
import { useRequestApproval } from "@/components/approval-deliverable-provider";
import { useTaskMenu } from "@/components/task-menu";
import { ContextMenu } from "@/components/ui/context-menu";
import { ApprovalPill } from "@/components/approval-pill";
import { DeliveryChips } from "@/components/design-atoms";
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
}

export function TaskCard({ task, role, onSelect, onStatusMove, onDragStart, onDragEnd }: TaskCardProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  const requestDone = useRequestDone();
  const requestApproval = useRequestApproval();
  const advance = getTaskAdvance(task);
  const changeRequest = getActiveChangeRequest(task);
  const taskMenu = useTaskMenu({
    task,
    role,
    onOpen: onSelect ? () => onSelect(task) : undefined,
    onStatusMove,
    requestDone,
    requestApproval,
  });

  async function handleAdvance() {
    if (!advance) return;
    if (advance.kind === "done") {
      requestDone({ task });
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
      className={`krowe-card priority-${task.priority} status-${task.status} ${isAwaitingApproval(task) ? "approval-pending" : ""} ${isDragging ? "dragging" : ""}`}
      draggable
      onDragStart={(e) => {
        setIsDragging(true);
        e.dataTransfer.setData("taskId", task.id);
        e.dataTransfer.effectAllowed = "move";
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
      <div className="krowe-rail" />

      <div className="krowe-card-row">
        {task.status === "done" && (
          <span className="krowe-card-check" aria-hidden="true">
            <Check width={11} height={11} strokeWidth={3} />
          </span>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link
            href={`/${role === "operator" ? "o" : "b"}/tasks/${task.id}`}
            className="krowe-card-title"
            style={{ display: "block", textDecoration: "none" }}
            onClick={(e) => {
              if (!onSelect) return;
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              onSelect(task);
            }}
          >
            {task.title}
          </Link>
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
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

      <DeliveryChips task={task} />

      <div className="krowe-card-meta">
        <div className="krowe-card-meta-left">
          <span className={`krowe-prio-dot ${task.priority}`}>
            <span className="d" />
          </span>
          <TaskTypeBadge type={task.type} />
          <TaskTags tags={task.tags} />
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

      <div className="krowe-card-foot">
        <span className="krowe-card-date">
          <CalendarDays width={12} height={12} strokeWidth={2} />
          {new Date(task.created_at).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            timeZone: "UTC",
          })}
        </span>
        <span className="krowe-card-submitter">
          <SubmitterAvatar creator={task.creator} />
          {submitterName(task.creator)}
        </span>
      </div>
    </div>
    <ContextMenu state={taskMenu.menu.state} items={taskMenu.items} onClose={taskMenu.menu.close} />
    {taskMenu.dialogs}
    {confirmDialog}
    </>
  );
}
