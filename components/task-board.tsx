"use client";

import { useState, useTransition, useOptimistic } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { TaskCard } from "@/components/task-card";
import { TaskDetailSheet } from "@/components/task-detail-sheet";
import { updateTaskStatus, reorderTask } from "@/lib/actions/tasks";
import { useRequestDone } from "@/components/done-deliverable-provider";
import type { Task, Engagement, TaskStatus, TaskPriority } from "@/lib/types";

const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const rankDiff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (rankDiff !== 0) return rankDiff;
    return (a.sort_order ?? 0) - (b.sort_order ?? 0);
  });
}

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "inbox", label: "Inbox" },
  { status: "in_progress", label: "In Progress" },
  { status: "blocked", label: "Approval" },
  { status: "done", label: "Done" },
];

type DropTarget = { taskId: string; position: "before" | "after" };

type OptimisticAction =
  | { type: "status"; taskId: string; status: TaskStatus }
  | { type: "reorder"; taskId: string; sort_order: number };

interface TaskBoardProps {
  tasks: Task[];
  engagements: Engagement[];
  currentUserId: string;
}

export function TaskBoard({ tasks, engagements, currentUserId }: TaskBoardProps) {
  const engagementMap = new Map(engagements.map((e) => [e.id, e.title]));
  const requestDone = useRequestDone();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("task"));
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);
  const [draggingTask, setDraggingTask] = useState<Task | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [, startTransition] = useTransition();

  const [optimisticTasks, dispatchOptimistic] = useOptimistic(
    tasks,
    (current, action: OptimisticAction) => {
      if (action.type === "status") {
        return current.map((t) => (t.id === action.taskId ? { ...t, status: action.status } : t));
      }
      if (action.type === "reorder") {
        return current.map((t) => (t.id === action.taskId ? { ...t, sort_order: action.sort_order } : t));
      }
      return current;
    }
  );

  const selectedTask = optimisticTasks.find((t) => t.id === selectedId) ?? null;

  function syncSelected(id: string | null) {
    setSelectedId(id);
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("task", id);
    else params.delete("task");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function handleColumnDragOver(e: React.DragEvent, status: TaskStatus) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverStatus(status);
  }

  function handleColumnDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverStatus(null);
      setDropTarget(null);
    }
  }

  function handleColumnDrop(e: React.DragEvent, status: TaskStatus) {
    e.preventDefault();
    setDragOverStatus(null);
    setDropTarget(null);
    setDraggingTask(null);
    const taskId = e.dataTransfer.getData("taskId");
    if (!taskId) return;

    if (status === "done") {
      const droppedTask = optimisticTasks.find((t) => t.id === taskId);
      if (droppedTask && droppedTask.status !== "done") {
        const priorStatus = droppedTask.status;
        startTransition(() => {
          dispatchOptimistic({ type: "status", taskId, status: "done" });
        });
        requestDone({
          task: droppedTask,
          onCommit: () => {},
          onCancel: () => {
            startTransition(() => {
              dispatchOptimistic({ type: "status", taskId, status: priorStatus });
            });
          },
        });
        return;
      }
    }

    startTransition(async () => {
      dispatchOptimistic({ type: "status", taskId, status });
      await updateTaskStatus(taskId, status);
    });
  }

  function handleCardDragOver(e: React.DragEvent, targetTask: Task) {
    if (!draggingTask) return;
    if (draggingTask.priority !== targetTask.priority) return;
    if (draggingTask.status !== targetTask.status) return;
    if (draggingTask.id === targetTask.id) return;

    e.stopPropagation();
    e.preventDefault();

    const rect = e.currentTarget.getBoundingClientRect();
    const position: "before" | "after" = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
    if (dropTarget?.taskId !== targetTask.id || dropTarget?.position !== position) {
      setDropTarget({ taskId: targetTask.id, position });
    }
    setDragOverStatus(null);
  }

  function handleCardDrop(e: React.DragEvent, targetTask: Task) {
    if (!draggingTask) return;
    if (draggingTask.priority !== targetTask.priority) return;
    if (draggingTask.status !== targetTask.status) return;
    if (draggingTask.id === targetTask.id) {
      setDropTarget(null);
      return;
    }

    e.stopPropagation();
    e.preventDefault();

    const target = dropTarget;
    const sourceTask = draggingTask;
    setDropTarget(null);
    setDraggingTask(null);
    if (!target) return;

    const group = sortTasks(
      optimisticTasks.filter(
        (t) =>
          t.status === targetTask.status &&
          t.priority === targetTask.priority &&
          t.id !== sourceTask.id
      )
    );
    const targetIdx = group.findIndex((t) => t.id === targetTask.id);

    let newOrder: number;
    if (target.position === "before") {
      if (targetIdx === 0) {
        newOrder = (group[0].sort_order ?? 0) - 1000;
      } else {
        newOrder = ((group[targetIdx - 1].sort_order ?? 0) + (group[targetIdx].sort_order ?? 0)) / 2;
      }
    } else {
      if (targetIdx === group.length - 1) {
        newOrder = (group[group.length - 1].sort_order ?? 0) + 1000;
      } else {
        newOrder = ((group[targetIdx].sort_order ?? 0) + (group[targetIdx + 1].sort_order ?? 0)) / 2;
      }
    }

    const taskId = sourceTask.id;
    startTransition(async () => {
      dispatchOptimistic({ type: "reorder", taskId, sort_order: newOrder });
      await reorderTask(taskId, newOrder);
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
          const columnTasks = sortTasks(optimisticTasks.filter((t) => t.status === status));
          const isOver = dragOverStatus === status;
          return (
            <div
              key={status}
              className={`flex flex-col gap-3 rounded-xl p-2 -m-2 transition-colors ${isOver ? "bg-neutral-100 ring-1 ring-neutral-200" : ""}`}
              onDragOver={(e) => handleColumnDragOver(e, status)}
              onDragLeave={handleColumnDragLeave}
              onDrop={(e) => handleColumnDrop(e, status)}
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
                <div
                  className={`rounded-lg border border-dashed py-8 text-center transition-colors ${isOver ? "border-neutral-300 bg-neutral-50" : "border-neutral-100"}`}
                >
                  <p className="text-xs text-neutral-300">{isOver ? "Drop here" : "Empty"}</p>
                </div>
              ) : (
                <div className="flex flex-col">
                  {columnTasks.map((task) => (
                    <div
                      key={task.id}
                      onDragOver={(e) => handleCardDragOver(e, task)}
                      onDrop={(e) => handleCardDrop(e, task)}
                    >
                      {dropTarget?.taskId === task.id && dropTarget.position === "before" && (
                        <div className="mx-1 mb-1 h-0.5 rounded-full bg-blue-400" />
                      )}
                      <div className="mb-3">
                        <TaskCard
                          task={task}
                          role="builder"
                          engagementTitle={engagementMap.get(task.engagement_id)}
                          onSelect={(t) => syncSelected(t.id)}
                          onDragStart={(t) => setDraggingTask(t)}
                          onDragEnd={() => {
                            setDraggingTask(null);
                            setDropTarget(null);
                          }}
                        />
                      </div>
                      {dropTarget?.taskId === task.id && dropTarget.position === "after" && (
                        <div className="mx-1 -mt-2 mb-1 h-0.5 rounded-full bg-blue-400" />
                      )}
                    </div>
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
