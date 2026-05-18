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
  { status: "inbox",       label: "Inbox" },
  { status: "in_progress", label: "In Progress" },
  { status: "blocked",     label: "Approval" },
  { status: "done",        label: "Done" },
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
      if (action.type === "status")
        return current.map((t) => t.id === action.taskId ? { ...t, status: action.status } : t);
      if (action.type === "reorder")
        return current.map((t) => t.id === action.taskId ? { ...t, sort_order: action.sort_order } : t);
      return current;
    }
  );

  const selectedTask = optimisticTasks.find((t) => t.id === selectedId) ?? null;

  function syncSelected(id: string | null) {
    setSelectedId(id);
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("task", id); else params.delete("task");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
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
        startTransition(() => { dispatchOptimistic({ type: "status", taskId, status: "done" }); });
        requestDone({
          task: droppedTask,
          onCommit: () => {},
          onCancel: () => {
            startTransition(() => { dispatchOptimistic({ type: "status", taskId, status: priorStatus }); });
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
    e.stopPropagation(); e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const position: "before" | "after" = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
    if (dropTarget?.taskId !== targetTask.id || dropTarget?.position !== position)
      setDropTarget({ taskId: targetTask.id, position });
    setDragOverStatus(null);
  }

  function handleCardDrop(e: React.DragEvent, targetTask: Task) {
    if (!draggingTask) return;
    if (draggingTask.priority !== targetTask.priority) return;
    if (draggingTask.status !== targetTask.status) return;
    if (draggingTask.id === targetTask.id) { setDropTarget(null); return; }
    e.stopPropagation(); e.preventDefault();
    const target = dropTarget;
    const sourceTask = draggingTask;
    setDropTarget(null); setDraggingTask(null);
    if (!target) return;
    const group = sortTasks(
      optimisticTasks.filter(
        (t) => t.status === targetTask.status && t.priority === targetTask.priority && t.id !== sourceTask.id
      )
    );
    const targetIdx = group.findIndex((t) => t.id === targetTask.id);
    let newOrder: number;
    if (target.position === "before") {
      newOrder = targetIdx === 0
        ? (group[0].sort_order ?? 0) - 1000
        : ((group[targetIdx - 1].sort_order ?? 0) + (group[targetIdx].sort_order ?? 0)) / 2;
    } else {
      newOrder = targetIdx === group.length - 1
        ? (group[group.length - 1].sort_order ?? 0) + 1000
        : ((group[targetIdx].sort_order ?? 0) + (group[targetIdx + 1].sort_order ?? 0)) / 2;
    }
    const taskId = sourceTask.id;
    startTransition(async () => {
      dispatchOptimistic({ type: "reorder", taskId, sort_order: newOrder });
      await reorderTask(taskId, newOrder);
    });
  }

  if (optimisticTasks.length === 0) {
    return (
      <div className="krowe-column-empty" style={{ maxWidth: 400 }}>
        No tasks yet — hit the + button to add something to the queue.
      </div>
    );
  }

  return (
    <>
      <div className="krowe-board">
        {COLUMNS.map(({ status, label }) => {
          const columnTasks = sortTasks(optimisticTasks.filter((t) => t.status === status));
          const isOver = dragOverStatus === status;
          return (
            <div
              key={status}
              className={`krowe-column ${isOver ? "drag-over" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragOverStatus(status); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) { setDragOverStatus(null); setDropTarget(null); } }}
              onDrop={(e) => handleColumnDrop(e, status)}
            >
              <div className="krowe-column-head">
                <span className="krowe-column-label">{label}</span>
                <span className="krowe-column-count">{columnTasks.length}</span>
                <span className="krowe-column-rule" />
              </div>
              {columnTasks.length === 0 ? (
                <div className="krowe-column-empty">{isOver ? "Drop here" : "Empty"}</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                  {columnTasks.map((task) => (
                    <div
                      key={task.id}
                      style={{ marginBottom: 12 }}
                      onDragOver={(e) => handleCardDragOver(e, task)}
                      onDrop={(e) => handleCardDrop(e, task)}
                    >
                      {dropTarget?.taskId === task.id && dropTarget.position === "before" && (
                        <div className="krowe-drop-indicator" />
                      )}
                      <TaskCard
                        task={task}
                        role="builder"
                        engagementTitle={engagementMap.get(task.engagement_id)}
                        onSelect={(t) => syncSelected(t.id)}
                        onDragStart={(t) => setDraggingTask(t)}
                        onDragEnd={() => { setDraggingTask(null); setDropTarget(null); }}
                      />
                      {dropTarget?.taskId === task.id && dropTarget.position === "after" && (
                        <div className="krowe-drop-indicator" />
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
