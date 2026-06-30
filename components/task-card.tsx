"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarDays, Check, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { updateTaskStatus } from "@/lib/actions/tasks";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useRequestDone } from "@/components/done-deliverable-provider";
import { useRequestApproval } from "@/components/approval-deliverable-provider";
import { ApprovalPill } from "@/components/approval-pill";
import { DeliveryChips } from "@/components/design-atoms";
import { TaskTypeBadge, TaskTags } from "@/components/task-type-badge";
import { submitterName } from "@/lib/utils";
import type { Task, Role, TaskStatus } from "@/lib/types";

const NEXT_STATUS: Record<TaskStatus, TaskStatus | null> = {
  inbox: "in_progress", in_progress: "blocked", blocked: "done", done: null,
};

const ADVANCE_LABEL: Record<TaskStatus, string> = {
  inbox: "In Progress", in_progress: "Approval", blocked: "Done", done: "",
};

interface TaskCardProps {
  task: Task;
  role: Role;
  engagementTitle?: string;
  onSelect?: (task: Task) => void;
  onDragStart?: (task: Task) => void;
  onDragEnd?: () => void;
}

export function TaskCard({ task, role, onSelect, onDragStart, onDragEnd }: TaskCardProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  const requestDone = useRequestDone();
  const requestApproval = useRequestApproval();
  const nextStatus = NEXT_STATUS[task.status];

  async function handleAdvance() {
    if (!nextStatus) return;
    if (nextStatus === "done") {
      requestDone({ task });
    } else if (nextStatus === "blocked") {
      requestApproval({ task });
    } else {
      await updateTaskStatus(task.id, nextStatus);
    }
  }

  return (
    <>
    <div
      className={`krowe-card priority-${task.priority} status-${task.status} ${isDragging ? "dragging" : ""}`}
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
          {role === "builder" && nextStatus && (
            <button
              className="krowe-advance-btn"
              onClick={(e) => { e.stopPropagation(); handleAdvance(); }}
            >
              <span style={{ fontFamily: "var(--font-mono)" }}>→</span>
              {ADVANCE_LABEL[task.status]}
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
        <span className="krowe-card-submitter">{submitterName(task.creator)}</span>
      </div>
    </div>
    {confirmDialog}
    </>
  );
}
