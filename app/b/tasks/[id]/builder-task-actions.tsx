"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { updateTask, updateTaskStatus, withdrawTaskApproval } from "@/lib/actions/tasks";
import { useRequestDone } from "@/components/done-deliverable-provider";
import { useRequestApproval } from "@/components/approval-deliverable-provider";
import { DeleteTaskButton } from "@/components/delete-task-button";
import type { Task, TaskStatus, TaskPriority } from "@/lib/types";
import { useRouter } from "next/navigation";

const STATUSES: { value: TaskStatus; label: string }[] = [
  { value: "backlog", label: "Backlog" },
  { value: "todo", label: "To-Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "done", label: "Done" },
];

const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

interface BuilderTaskActionsProps {
  task: Task;
  onSuccess?: () => void;
}

export function BuilderTaskActions({ task, onSuccess }: BuilderTaskActionsProps) {
  const router = useRouter();
  const requestDone = useRequestDone();
  const requestApproval = useRequestApproval();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handleSave(formData: FormData) {
    startTransition(async () => {
      const result = await updateTask(formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        router.refresh();
      }
    });
  }

  function handleStatusChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const status = e.target.value as TaskStatus;
    if (status === "done" && task.status !== "done") {
      requestDone({
        task,
        onCommit: () => router.refresh(),
        onCancel: () => router.refresh(),
      });
      return;
    }
    startTransition(async () => {
      await updateTaskStatus(task.id, status);
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm space-y-5">
      <h2 className="text-sm font-semibold text-neutral-900">Edit Task</h2>

      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">Status</label>
        <Select value={task.status} onChange={handleStatusChange} disabled={isPending}>
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        {task.status === "in_progress" && !task.approval_sent_at && (
          <Button
            type="button"
            variant="outline"
            className="mt-2 w-full"
            disabled={isPending}
            onClick={() =>
              requestApproval({
                task,
                onCommit: () => router.refresh(),
              })
            }
          >
            Send for approval
          </Button>
        )}
        {task.approval_sent_at && !task.approval_approved_at && (
          <Button
            type="button"
            variant="outline"
            className="mt-2 w-full"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await withdrawTaskApproval(task.id);
                if ("error" in result) setError(result.error);
                else router.refresh();
              })
            }
          >
            Unsend from approval
          </Button>
        )}
      </div>

      <form action={handleSave} className="space-y-4">
        <input type="hidden" name="id" value={task.id} />
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1">Title</label>
          <Input name="title" defaultValue={task.title} required />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1">Description</label>
          <Textarea name="description" defaultValue={task.description ?? ""} rows={4} />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1">Priority</label>
          <Select name="priority" defaultValue={task.priority}>
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1">
            Estimate (hours)
          </label>
          <Input
            name="builder_estimate_hours"
            type="number"
            min="0"
            step="0.5"
            defaultValue={task.builder_estimate_hours ?? ""}
            placeholder="e.g. 4"
          />
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <Button type="submit" disabled={isPending} className="w-full">
          {saved ? "Saved!" : isPending ? "Saving…" : "Save changes"}
        </Button>
      </form>
      <DeleteTaskButton taskId={task.id} taskTitle={task.title} variant="full" redirectTo={onSuccess ? undefined : "/b"} onSuccess={onSuccess} />
    </div>
  );
}
