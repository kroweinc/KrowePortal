"use client";

import { useEffect } from "react";
import { Sparkles } from "lucide-react";
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
import { useRequestDone } from "@/components/done-deliverable-provider";
import { TaskAttachments } from "@/components/task-attachments";
import { TaskSubtasks } from "@/components/task-subtasks";
import { useTaskView, usePlainEnglish } from "@/components/plain-english-context";
import { PlainEnglishToggle } from "@/components/plain-english-toggle";
import { STATUS_LABELS } from "@/lib/utils";
import type { Task, Role, TaskStatus } from "@/lib/types";

const PRIORITY_OPTIONS = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
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
  currentUserId: string;
  engagementTitle?: string;
  onOpenChange: (open: boolean) => void;
}

export function TaskDetailSheet({
  task,
  role,
  currentUserId,
  engagementTitle,
  onOpenChange,
}: TaskDetailSheetProps) {
  return (
    <Sheet open={!!task} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col overflow-y-auto">
        {task && (
          <TaskDetailBody
            task={task}
            role={role}
            currentUserId={currentUserId}
            engagementTitle={engagementTitle}
            onOpenChange={onOpenChange}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

interface TaskDetailBodyProps {
  task: Task;
  role: Role;
  currentUserId: string;
  engagementTitle?: string;
  onOpenChange: (open: boolean) => void;
}

function TaskDetailBody({
  task,
  role,
  currentUserId,
  engagementTitle,
  onOpenChange,
}: TaskDetailBodyProps) {
  const requestDone = useRequestDone();
  const view = useTaskView(task);
  const { enabled: plainEnabled, ensureTaskCached } = usePlainEnglish();
  const showSimplified = role === "operator" && view.simplified;
  const displayTitle = showSimplified ? view.title : task.title;
  const displayDescription = showSimplified
    ? view.description ?? ""
    : task.description ?? "";

  useEffect(() => {
    if (role !== "operator") return;
    if (!plainEnabled) return;
    ensureTaskCached(task);
  }, [role, plainEnabled, task, ensureTaskCached]);

  async function saveField(field: string, value: string) {
    const fd = new FormData();
    fd.set("id", task.id);
    fd.set(field, value);
    await updateTask(fd);
  }

  async function saveStatus(value: string) {
    if (value === "done" && task.status !== "done") {
      return new Promise<void>((resolve) => {
        requestDone({
          task,
          onCommit: resolve,
          onCancel: resolve,
        });
      });
    }
    await updateTaskStatus(task.id, value as TaskStatus);
  }

  async function saveVisibility(newVisible: boolean) {
    await toggleVisibility(task.id, newVisible);
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle asChild>
          <div className="text-base font-semibold text-neutral-900 leading-snug pr-6 flex items-start gap-2">
            <div className="flex-1">
              <InlineText
                value={displayTitle}
                onSave={(v) => saveField("title", v)}
                readOnly={role === "operator"}
                placeholder="Untitled task"
                className="text-base font-semibold text-neutral-900"
              />
            </div>
            {showSimplified && (
              <span
                title="Rewritten in plain English"
                className="mt-0.5 inline-flex items-center text-violet-500"
              >
                <Sparkles className="h-4 w-4" />
              </span>
            )}
          </div>
        </SheetTitle>
        {engagementTitle && (
          <p className="text-xs text-neutral-400 mt-1">{engagementTitle}</p>
        )}
        {role === "operator" && (
          <div className="mt-3">
            <PlainEnglishToggle />
          </div>
        )}
      </SheetHeader>

      <div className="flex-1 space-y-5 px-6 pt-2 pb-5">
        <div>
          <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-1.5">
            Description
          </p>
          <InlineTextarea
            value={displayDescription}
            onSave={(v) => saveField("description", v)}
            readOnly={role === "operator"}
            placeholder="No description"
          />
        </div>

        {task.status === "done" && (() => {
          const deliverableAttachments = (task.task_attachments ?? []).filter(a => a.is_deliverable);
          const hasContent = task.pushed_to_main || task.completion_note || deliverableAttachments.length > 0;
          if (!hasContent) return null;
          return (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                Deliverable
              </p>
              {(task.pushed_to_main || task.completion_note) && (
                <div className="rounded-md border border-green-100 bg-green-50 px-3 py-2.5 space-y-1">
                  {task.pushed_to_main && (
                    <div className="flex items-center gap-1.5 text-xs font-medium text-green-700">
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
                        <path d="M9 18c-4.51 2-5-2-7-2" />
                      </svg>
                      Pushed to main
                    </div>
                  )}
                  {task.completion_note && (
                    <p className="text-xs text-green-700">{task.completion_note}</p>
                  )}
                </div>
              )}
              <TaskAttachments
                key={`deliverable-attachments-${task.id}`}
                taskId={task.id}
                role={role}
                currentUserId={currentUserId}
                initial={deliverableAttachments}
                isDeliverable={true}
                readOnly={true}
              />
            </div>
          );
        })()}

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

        <TaskAttachments
          key={`attachments-${task.id}`}
          taskId={task.id}
          role={role}
          currentUserId={currentUserId}
          initial={(task.task_attachments ?? []).filter(a => !a.is_deliverable)}
          isDeliverable={false}
        />

        <TaskSubtasks key={`subtasks-${task.id}`} taskId={task.id} task={task} />

        <DeleteTaskButton
          taskId={task.id}
          taskTitle={task.title}
          variant="full"
          onSuccess={() => onOpenChange(false)}
        />
      </div>
    </>
  );
}
