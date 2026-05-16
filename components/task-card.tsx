"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toggleVisibility, updateTaskStatus } from "@/lib/actions/tasks";
import { useRequestDone } from "@/components/done-deliverable-provider";
import { DeleteTaskButton } from "@/components/delete-task-button";
import type { Task, TaskStatus, Role, TaskPriority } from "@/lib/types";

const PRIORITY_TINT: Record<TaskPriority, string> = {
  urgent: "bg-red-100/60 animate-urgent-pulse",
  low: "bg-green-50/40",
  medium: "bg-amber-50/40",
  high: "bg-red-50/40",
};

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  urgent: "Urgent",
  low: "Low",
  medium: "Medium",
  high: "High",
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  inbox: "In Progress",
  in_progress: "In Progress",
  blocked: "Approval",
  done: "Done",
};

const NEXT_STATUS: Record<TaskStatus, TaskStatus | null> = {
  inbox: "in_progress",
  in_progress: "done",
  blocked: "in_progress",
  done: null,
};

interface TaskCardProps {
  task: Task;
  role: Role;
  engagementTitle?: string;
  onSelect?: (task: Task) => void;
  onDragStart?: (task: Task) => void;
  onDragEnd?: () => void;
}

export function TaskCard({ task, role, engagementTitle, onSelect, onDragStart, onDragEnd }: TaskCardProps) {
  const nextStatus = NEXT_STATUS[task.status];
  const [isDragging, setIsDragging] = useState(false);
  const requestDone = useRequestDone();

  async function handleStatusClick() {
    if (!nextStatus) return;
    if (nextStatus === "done") {
      requestDone({ task });
    } else {
      await updateTaskStatus(task.id, nextStatus);
    }
  }

  async function handleVisibilityToggle() {
    await toggleVisibility(task.id, !task.operator_visible);
  }

  return (
    <Card
      className={`group cursor-grab transition-opacity ${PRIORITY_TINT[task.priority]} ${isDragging ? "opacity-40 cursor-grabbing" : ""}`}
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
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <Link
            href={`/${role === "operator" ? "o" : "b"}/tasks/${task.id}`}
            className="flex-1"
            onClick={(e) => {
              if (!onSelect) return;
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              onSelect(task);
            }}
          >
            <CardTitle className="text-sm font-medium leading-snug hover:underline">
              {task.title}
            </CardTitle>
          </Link>
          <div className="flex items-center gap-1.5">
            <Badge variant={task.priority}>{PRIORITY_LABELS[task.priority]}</Badge>
          </div>
        </div>
        {engagementTitle && (
          <p className="text-xs text-neutral-400">{engagementTitle}</p>
        )}
      </CardHeader>
      <CardContent>
        {task.description && (
          <p className="mb-3 text-sm text-neutral-500 line-clamp-2">
            {task.description}
          </p>
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Badge variant={task.source === "operator_request" ? "operator" : "builder"}>
              {task.source === "operator_request" ? "operator" : "builder"}
            </Badge>
            {task.builder_estimate_hours && (
              <span className="flex items-center gap-1 text-xs text-neutral-400">
                <Clock className="h-3 w-3" />
                {task.builder_estimate_hours}h
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {role === "builder" && (
              <button
                onClick={handleVisibilityToggle}
                title={task.operator_visible ? "Hide from operator" : "Show to operator"}
                className="text-neutral-400 hover:text-neutral-700 transition-colors"
              >
                {task.operator_visible ? (
                  <Eye className="h-4 w-4" />
                ) : (
                  <EyeOff className="h-4 w-4" />
                )}
              </button>
            )}
            {role === "builder" && nextStatus && (
              <Button size="sm" variant="outline" onClick={handleStatusClick} className="whitespace-nowrap">
                → {STATUS_LABELS[nextStatus]}
              </Button>
            )}
            <DeleteTaskButton taskId={task.id} taskTitle={task.title} variant="icon" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
