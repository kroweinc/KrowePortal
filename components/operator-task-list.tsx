"use client";

import { useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Trash2 } from "lucide-react";
import { TaskDetailSheet } from "@/components/task-detail-sheet";
import { DeliveryChips } from "@/components/design-atoms";
import { deleteTask } from "@/lib/actions/tasks";
import { sortByPriority } from "@/lib/utils";
import type { Task } from "@/lib/types";

const STATUS_ORDER = ["inbox", "in_progress", "blocked", "done"] as const;
const STATUS_LABELS: Record<string, string> = {
  inbox: "Inbox", in_progress: "In Progress", blocked: "Approval", done: "Done",
};
const PRIORITY_LABEL: Record<string, string> = {
  urgent: "Urgent", high: "High", medium: "Medium", low: "Low",
};

interface OperatorTaskListProps {
  tasks: Task[];
  currentUserId: string;
}

export function OperatorTaskList({ tasks, currentUserId }: OperatorTaskListProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("task"));

  const selectedTask = tasks.find((t) => t.id === selectedId) ?? null;

  function syncSelected(id: string | null) {
    setSelectedId(id);
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("task", id); else params.delete("task");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  if (tasks.length === 0) {
    return (
      <div className="krowe-column-empty" style={{ maxWidth: 400, margin: "0 auto" }}>
        Nothing here yet — your builder hasn&apos;t shared any tasks.
      </div>
    );
  }

  const grouped = STATUS_ORDER.reduce<Record<string, Task[]>>((acc, s) => {
    acc[s] = sortByPriority(tasks.filter((t) => t.status === s));
    return acc;
  }, {} as Record<string, Task[]>);

  const sourceLabel = (t: Task) => t.source === "operator_request" ? "operator" : "builder";
  const showApproval = (t: Task) => t.status === "blocked" || t.status === "done";

  return (
    <>
      <div className="krowe-op-list">
        {STATUS_ORDER.map((status) => {
          const group = grouped[status];
          if (group.length === 0) return null;
          return (
            <div key={status}>
              <div className="krowe-op-group-head">
                <span className="krowe-column-label">{STATUS_LABELS[status]}</span>
                <span className="krowe-column-count">{group.length}</span>
                <span className="krowe-op-group-rule" />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {group.map((task) => (
                  <div
                    key={task.id}
                    className={`krowe-op-card priority-${task.priority} status-${task.status}`}
                    onClick={() => syncSelected(task.id)}
                  >
                    <div className="krowe-rail" />
                    <div className="krowe-op-card-row">
                      <div className="krowe-op-card-title">{task.title}</div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        {showApproval(task) && (
                          <span className="krowe-chip krowe-chip-approval">Approved</span>
                        )}
                        <span className={`krowe-chip krowe-chip-priority ${task.priority}`}>
                          {PRIORITY_LABEL[task.priority]}
                        </span>
                      </div>
                    </div>
                    {task.description && (
                      <p className="krowe-op-card-desc">{task.description}</p>
                    )}
                    <DeliveryChips task={task} />
                    <div className="krowe-op-card-foot">
                      <span className={`krowe-chip krowe-chip-source ${sourceLabel(task)}`}>
                        {sourceLabel(task)}
                      </span>
                      <button
                        className="krowe-iconbtn danger"
                        title="Delete task"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!window.confirm(`Delete "${task.title}"?`)) return;
                          deleteTask(task.id).then(() => router.refresh());
                        }}
                      >
                        <Trash2 width={14} height={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <TaskDetailSheet
        task={selectedTask}
        role="operator"
        currentUserId={currentUserId}
        onOpenChange={(open) => !open && syncSelected(null)}
      />
    </>
  );
}
