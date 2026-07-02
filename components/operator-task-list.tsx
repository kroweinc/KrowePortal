"use client";

import { useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Trash2 } from "lucide-react";
import { TaskDetailSheet } from "@/components/task-detail-sheet";
import { DeliveryChips } from "@/components/design-atoms";
import { ApprovalPill } from "@/components/approval-pill";
import { TaskTypeBadge, TaskTags } from "@/components/task-type-badge";
import { SubmitterAvatar } from "@/components/submitter-avatar";
import { PlainEnglishProvider } from "@/components/plain-english-context";
import { deleteTask } from "@/lib/actions/tasks";
import { STATUS_LABELS, isAwaitingApproval, sortWithApprovalPin, submitterName } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useTaskMenu } from "@/components/task-menu";
import { ContextMenu } from "@/components/ui/context-menu";
import type { Task } from "@/lib/types";

const STATUS_ORDER = ["backlog", "todo", "in_progress", "done"] as const;
const PRIORITY_LABEL: Record<string, string> = {
  urgent: "Urgent", high: "High", medium: "Medium", low: "Low",
};

interface OperatorTaskListProps {
  tasks: Task[];
  currentUserId: string;
}

/* Row extracted so each card gets its own right-click menu state; the delete
   confirmation stays in the parent (shared dialog) and is reused by both the
   trash button and the menu's Delete item via onDelete. */
function OperatorTaskRow({
  task,
  onSelect,
  onDelete,
}: {
  task: Task;
  onSelect: () => void;
  onDelete: () => Promise<void>;
}) {
  const { menu, items } = useTaskMenu({ task, role: "operator", onOpen: onSelect, onDelete });

  return (
    <div
      className={`krowe-op-card priority-${task.priority} status-${task.status} ${isAwaitingApproval(task) ? "approval-pending" : ""}`}
      onClick={onSelect}
      onContextMenu={menu.openAtEvent}
    >
      <div className="krowe-rail" />
      <div className="krowe-op-card-row">
        <div className="krowe-op-card-title">{task.title}</div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
          <ApprovalPill task={task} role="operator" />
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
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flexWrap: "wrap" }}>
          <TaskTypeBadge type={task.type} />
          <TaskTags tags={task.tags} />
          <span className="krowe-card-submitter">
            <SubmitterAvatar creator={task.creator} />
            {submitterName(task.creator)}
          </span>
        </div>
        <button
          className="krowe-iconbtn danger"
          title="Delete task"
          onClick={(e) => {
            e.stopPropagation();
            void onDelete();
          }}
        >
          <Trash2 width={14} height={14} />
        </button>
      </div>
      <ContextMenu state={menu.state} items={items} onClose={menu.close} />
    </div>
  );
}

export function OperatorTaskList({ tasks, currentUserId }: OperatorTaskListProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("task"));
  const [confirm, confirmDialog] = useConfirm();

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
    acc[s] = sortWithApprovalPin(tasks.filter((t) => t.status === s));
    return acc;
  }, {} as Record<string, Task[]>);

  return (
    <PlainEnglishProvider>
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
                  <OperatorTaskRow
                    key={task.id}
                    task={task}
                    onSelect={() => syncSelected(task.id)}
                    onDelete={async () => {
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
                      deleteTask(task.id).then(() => router.refresh());
                    }}
                  />
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
      {confirmDialog}
    </PlainEnglishProvider>
  );
}
