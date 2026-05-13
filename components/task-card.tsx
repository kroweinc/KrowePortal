"use client";

import Link from "next/link";
import { Eye, EyeOff, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toggleVisibility, updateTaskStatus } from "@/lib/actions/tasks";
import type { Task, TaskStatus, Role } from "@/lib/types";

const STATUS_LABELS: Record<TaskStatus, string> = {
  inbox: "Inbox",
  in_progress: "In Progress",
  blocked: "Blocked",
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
}

export function TaskCard({ task, role, engagementTitle }: TaskCardProps) {
  const nextStatus = NEXT_STATUS[task.status];

  async function handleStatusClick() {
    if (!nextStatus) return;
    await updateTaskStatus(task.id, nextStatus);
  }

  async function handleVisibilityToggle() {
    await toggleVisibility(task.id, !task.operator_visible);
  }

  return (
    <Card className="group">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <Link
            href={`/${role === "operator" ? "o" : "b"}/tasks/${task.id}`}
            className="flex-1"
          >
            <CardTitle className="text-sm font-medium leading-snug hover:underline">
              {task.title}
            </CardTitle>
          </Link>
          <Badge variant={task.status as "inbox" | "in_progress" | "blocked" | "done"}>
            {STATUS_LABELS[task.status]}
          </Badge>
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
              <Button size="sm" variant="outline" onClick={handleStatusClick}>
                → {STATUS_LABELS[nextStatus]}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
