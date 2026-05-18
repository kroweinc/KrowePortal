"use client";

import { useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { TaskCard } from "@/components/task-card";
import { TaskDetailSheet } from "@/components/task-detail-sheet";
import { sortByPriority } from "@/lib/utils";
import type { Task } from "@/lib/types";

const STATUS_ORDER = ["inbox", "in_progress", "blocked", "done"] as const;
const STATUS_LABELS: Record<string, string> = {
  inbox: "In Progress",
  in_progress: "In Progress",
  blocked: "Approval",
  done: "Done",
};

interface OperatorTaskListProps {
  tasks: Task[];
  currentUserId: string;
}

export function OperatorTaskList({ tasks, currentUserId }: OperatorTaskListProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get("task")
  );

  const selectedTask = tasks.find((t) => t.id === selectedId) ?? null;

  function syncSelected(id: string | null) {
    setSelectedId(id);
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("task", id);
    else params.delete("task");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  if (tasks.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-200 py-12 text-center">
        <p className="text-sm text-neutral-400">No tasks yet. Describe your first need below.</p>
      </div>
    );
  }

  const grouped = STATUS_ORDER.reduce<Record<string, Task[]>>((acc, s) => {
    acc[s] = sortByPriority(tasks.filter((t) => t.status === s));
    return acc;
  }, {} as Record<string, Task[]>);

  return (
    <>
      <div className="space-y-8">
        {STATUS_ORDER.map((status) => {
          const group = grouped[status];
          if (group.length === 0) return null;
          return (
            <div key={status}>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-400">
                {STATUS_LABELS[status]} · {group.length}
              </h3>
              <div className="space-y-3">
                {group.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onSelect={(t) => syncSelected(t.id)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <TaskDetailSheet
        task={selectedTask}
        currentUserId={currentUserId}
        onOpenChange={(open) => !open && syncSelected(null)}
      />
    </>
  );
}
