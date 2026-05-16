"use client";

import { useState, useTransition, useOptimistic } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { TaskCard } from "@/components/task-card";
import { TaskDetailSheet } from "@/components/task-detail-sheet";
import { updateTaskStatus } from "@/lib/actions/tasks";
import { sortByPriority } from "@/lib/utils";
import type { Task, Engagement, TaskStatus } from "@/lib/types";

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "inbox", label: "Inbox" },
  { status: "in_progress", label: "In Progress" },
  { status: "blocked", label: "Approval" },
  { status: "done", label: "Done" },
];

interface TaskBoardProps {
  tasks: Task[];
  engagements: Engagement[];
  currentUserId: string;
}

export function TaskBoard({ tasks, engagements, currentUserId }: TaskBoardProps) {
  const engagementMap = new Map(engagements.map((e) => [e.id, e.title]));
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get("task")
  );
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);
  const [, startTransition] = useTransition();
  const [optimisticTasks, setOptimisticTask] = useOptimistic(
    tasks,
    (current, { taskId, status }: { taskId: string; status: TaskStatus }) =>
      current.map((t) => (t.id === taskId ? { ...t, status } : t))
  );

  const selectedTask = optimisticTasks.find((t) => t.id === selectedId) ?? null;

  function syncSelected(id: string | null) {
    setSelectedId(id);
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("task", id);
    else params.delete("task");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function handleDragOver(e: React.DragEvent, status: TaskStatus) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverStatus(status);
  }

  function handleDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverStatus(null);
    }
  }

  function handleDrop(e: React.DragEvent, status: TaskStatus) {
    e.preventDefault();
    setDragOverStatus(null);
    const taskId = e.dataTransfer.getData("taskId");
    if (!taskId) return;
    startTransition(async () => {
      setOptimisticTask({ taskId, status });
      await updateTaskStatus(taskId, status);
    });
  }

  if (optimisticTasks.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-200 py-12 text-center">
        <p className="text-sm text-neutral-400">
          No tasks across any of your engagements yet.
        </p>
      </div>
    );
  }

  return (
    <>
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {COLUMNS.map(({ status, label }) => {
        const columnTasks = sortByPriority(optimisticTasks.filter((t) => t.status === status));
        const isOver = dragOverStatus === status;
        return (
          <div
            key={status}
            className={`flex flex-col gap-3 rounded-xl p-2 -m-2 transition-colors ${isOver ? "bg-neutral-100 ring-1 ring-neutral-200" : ""}`}
            onDragOver={(e) => handleDragOver(e, status)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, status)}
          >
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                {label}
              </h3>
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">
                {columnTasks.length}
              </span>
            </div>
            {columnTasks.length === 0 ? (
              <div className={`rounded-lg border border-dashed py-8 text-center transition-colors ${isOver ? "border-neutral-300 bg-neutral-50" : "border-neutral-100"}`}>
                <p className="text-xs text-neutral-300">{isOver ? "Drop here" : "Empty"}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {columnTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    role="builder"
                    engagementTitle={engagementMap.get(task.engagement_id)}
                    onSelect={(t) => syncSelected(t.id)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
      <TaskDetailSheet
        task={selectedTask}
        role="builder"
        currentUserId={currentUserId}
        engagementTitle={selectedTask ? engagementMap.get(selectedTask.engagement_id) : undefined}
        onOpenChange={(open) => !open && syncSelected(null)}
      />
    </>
  );
}
