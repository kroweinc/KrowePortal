"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, CalendarDays, Check, ExternalLink, MoreHorizontal, Trash2 } from "lucide-react";
import { updateTaskStatus, deleteTask } from "@/lib/actions/tasks";
import { useRequestDone } from "@/components/done-deliverable-provider";
import { useRequestApproval } from "@/components/approval-deliverable-provider";
import { ApprovalPill } from "@/components/approval-pill";
import { DeliveryChips } from "@/components/design-atoms";
import { useContextMenu, ContextMenu, type MenuItem } from "@/components/ui/context-menu";
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
  const router = useRouter();
  const [isDragging, setIsDragging] = useState(false);
  const requestDone = useRequestDone();
  const requestApproval = useRequestApproval();
  const menu = useContextMenu();
  const nextStatus = NEXT_STATUS[task.status];
  const sourceLabel = task.source === "operator_request" ? "operator" : "builder";
  const taskHref = `/${role === "operator" ? "o" : "b"}/tasks/${task.id}`;

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

  function handleDelete() {
    if (!window.confirm(`Delete "${task.title}"? This cannot be undone.`)) return;
    deleteTask(task.id)
      .then((res) => {
        if (res && typeof res === "object" && "error" in res && res.error) {
          toast.error(res.error as string);
        }
      })
      .catch(() => toast.error("Couldn't delete the task. Please try again."));
  }

  const menuItems: MenuItem[] = [
    {
      label: "Open",
      icon: <ExternalLink size={15} strokeWidth={1.9} />,
      onSelect: () => (onSelect ? onSelect(task) : router.push(taskHref)),
    },
    ...(role === "builder" && nextStatus
      ? [
          {
            label: `Move to ${ADVANCE_LABEL[task.status]}`,
            icon: <ArrowRight size={15} strokeWidth={1.9} />,
            onSelect: handleAdvance,
          },
        ]
      : []),
    {
      label: "Delete",
      icon: <Trash2 size={15} strokeWidth={1.9} />,
      destructive: true,
      separatorBefore: true,
      onSelect: handleDelete,
    },
  ];

  return (
    <div
      className={`krowe-card priority-${task.priority} status-${task.status} ${isDragging ? "dragging" : ""}`}
      draggable
      onContextMenu={menu.openAtEvent}
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
          <span className={`krowe-chip krowe-chip-source ${sourceLabel}`}>{sourceLabel}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
          </div>
          <button
            type="button"
            className="ctx-kebab"
            title="Task actions"
            aria-label="Task actions"
            onClick={(e) => {
              e.stopPropagation();
              menu.openAtAnchor(e.currentTarget);
            }}
          >
            <MoreHorizontal width={16} height={16} />
          </button>
          <ContextMenu state={menu.state} items={menuItems} onClose={menu.close} />
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
      </div>
    </div>
  );
}
