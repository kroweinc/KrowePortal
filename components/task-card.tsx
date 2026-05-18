"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, Trash2 } from "lucide-react";
import { toggleVisibility, updateTaskStatus } from "@/lib/actions/tasks";
import { useRequestDone } from "@/components/done-deliverable-provider";
import type { Task, Role, TaskStatus, TaskPriority } from "@/lib/types";

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  urgent: "Urgent", high: "High", medium: "Medium", low: "Low",
};

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
  const requestDone = useRequestDone();
  const nextStatus = NEXT_STATUS[task.status];
  const sourceLabel = task.source === "operator_request" ? "operator" : "builder";
  const showApproval = task.status === "blocked" || task.status === "done";

  async function handleAdvance() {
    if (!nextStatus) return;
    if (nextStatus === "done") {
      requestDone({ task });
    } else {
      await updateTaskStatus(task.id, nextStatus);
    }
  }

  async function handleVisibilityToggle(e: React.MouseEvent) {
    e.stopPropagation();
    await toggleVisibility(task.id, !task.operator_visible);
  }

  return (
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
          {showApproval && (
            <span className="krowe-chip krowe-chip-approval">Approved</span>
          )}
          <span className={`krowe-chip krowe-chip-priority ${task.priority}`}>
            {PRIORITY_LABEL[task.priority]}
          </span>
        </div>
      </div>

      {task.description && (
        <p className="krowe-card-desc">{task.description}</p>
      )}

      <div className="krowe-card-meta">
        <div className="krowe-card-meta-left">
          <span className={`krowe-chip krowe-chip-source ${sourceLabel}`}>{sourceLabel}</span>
          {role === "builder" && (
            <button
              className="krowe-iconbtn"
              title={task.operator_visible ? "Visible to operator" : "Hidden from operator"}
              onClick={handleVisibilityToggle}
            >
              {task.operator_visible
                ? <Eye width={14} height={14} />
                : <EyeOff width={14} height={14} />}
            </button>
          )}
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
            onClick={(e) => {
              e.stopPropagation();
              if (!window.confirm(`Delete "${task.title}"? This cannot be undone.`)) return;
              import("@/lib/actions/tasks").then(({ deleteTask }) => deleteTask(task.id));
            }}
          >
            <Trash2 width={14} height={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
