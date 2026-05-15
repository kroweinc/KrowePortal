"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { DeleteTaskButton } from "@/components/delete-task-button";
import {
  InlineText,
  InlineTextarea,
  InlineSelect,
  InlineToggle,
} from "@/components/inline-edit";
import { updateTask, updateTaskStatus, toggleVisibility } from "@/lib/actions/tasks";
import { STATUS_LABELS } from "@/lib/utils";
import type { Task, Role, TaskStatus, TaskPriority } from "@/lib/types";

const PRIORITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const STATUS_OPTIONS = [
  { value: "inbox", label: "Inbox" },
  { value: "in_progress", label: "In Progress" },
  { value: "blocked", label: "Approval" },
  { value: "done", label: "Done" },
];

interface TaskDetailSheetProps {
  task: Task | null;
  role: Role;
  engagementTitle?: string;
  onOpenChange: (open: boolean) => void;
}

export function TaskDetailSheet({
  task,
  role,
  engagementTitle,
  onOpenChange,
}: TaskDetailSheetProps) {
  async function saveField(field: string, value: string) {
    if (!task) return;
    const fd = new FormData();
    fd.set("id", task.id);
    fd.set(field, value);
    await updateTask(fd);
  }

  async function saveStatus(value: string) {
    if (!task) return;
    await updateTaskStatus(task.id, value as TaskStatus);
  }

  async function saveVisibility(newVisible: boolean) {
    if (!task) return;
    await toggleVisibility(task.id, newVisible);
  }

  return (
    <Sheet open={!!task} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col overflow-y-auto">
        {task && (
          <>
            <SheetHeader>
              <SheetTitle asChild>
                <div className="text-base font-semibold text-neutral-900 leading-snug pr-6">
                  <InlineText
                    value={task.title}
                    onSave={(v) => saveField("title", v)}
                    readOnly={role === "operator"}
                    placeholder="Untitled task"
                    className="text-base font-semibold text-neutral-900"
                  />
                </div>
              </SheetTitle>
              {engagementTitle && (
                <p className="text-xs text-neutral-400 mt-1">{engagementTitle}</p>
              )}
            </SheetHeader>

            <div className="flex-1 space-y-5 px-6 pt-2 pb-5">
              <div>
                <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-1.5">
                  Description
                </p>
                <InlineTextarea
                  value={task.description ?? ""}
                  onSave={(v) => saveField("description", v)}
                  readOnly={role === "operator"}
                  placeholder="No description"
                />
              </div>

              <div className="flex flex-wrap gap-3 text-xs text-neutral-400">
                <span>
                  Source:{" "}
                  <Badge variant={task.source === "operator_request" ? "operator" : "builder"}>
                    {task.source === "operator_request" ? "You requested this" : "Builder added"}
                  </Badge>
                </span>

                <InlineSelect
                  label="Priority"
                  value={task.priority}
                  options={PRIORITY_OPTIONS}
                  onSave={(v) => saveField("priority", v)}
                />

                {role === "builder" ? (
                  <InlineSelect
                    label="Status"
                    value={task.status}
                    options={STATUS_OPTIONS}
                    onSave={saveStatus}
                  />
                ) : (
                  <span>
                    Status:{" "}
                    <Badge variant={task.status}>{STATUS_LABELS[task.status]}</Badge>
                  </span>
                )}

                {role === "builder" && (
                  <InlineToggle
                    value={task.operator_visible}
                    onToggle={saveVisibility}
                    trueLabel="Visible to operator"
                    falseLabel="Hidden from operator"
                    trueBadgeVariant="secondary"
                    falseBadgeVariant="outline"
                  />
                )}

                {task.builder_estimate_hours != null && (
                  <span>Estimate: {task.builder_estimate_hours}h</span>
                )}

                <span>Added: {new Date(task.created_at).toLocaleDateString()}</span>
              </div>

              <DeleteTaskButton
                taskId={task.id}
                taskTitle={task.title}
                variant="full"
                onSuccess={() => onOpenChange(false)}
              />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
