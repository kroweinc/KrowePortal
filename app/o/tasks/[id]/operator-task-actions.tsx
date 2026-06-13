"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { Select } from "@/components/ui/select";
import { updateTask, approveTask } from "@/lib/actions/tasks";
import type { Task, TaskPriority } from "@/lib/types";
import { useRouter } from "next/navigation";

const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

interface OperatorTaskActionsProps {
  task: Task;
  onSuccess?: () => void;
}

export function OperatorTaskActions({ task, onSuccess }: OperatorTaskActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const awaitingApproval = !!task.approval_sent_at && !task.approval_approved_at;

  function handlePriorityChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const formData = new FormData();
    formData.set("id", task.id);
    formData.set("priority", e.target.value);
    startTransition(async () => {
      await updateTask(formData);
      router.refresh();
    });
  }

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      const result = await approveTask(task.id);
      if (result && "error" in result) {
        setError(result.error);
        return;
      }
      onSuccess?.();
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">Priority</label>
        <Select value={task.priority} onChange={handlePriorityChange} disabled={isPending}>
          {PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>
      </div>

      {awaitingApproval && (
        <div>
          <button
            type="button"
            onClick={handleApprove}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60"
          >
            <Check width={14} height={14} strokeWidth={3} />
            Approve deliverable
          </button>
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
