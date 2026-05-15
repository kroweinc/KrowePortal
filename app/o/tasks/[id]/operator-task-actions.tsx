"use client";

import { useTransition } from "react";
import { Select } from "@/components/ui/select";
import { updateTask } from "@/lib/actions/tasks";
import type { Task, TaskPriority } from "@/lib/types";
import { useRouter } from "next/navigation";

const PRIORITIES: { value: TaskPriority; label: string }[] = [
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

  function handlePriorityChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const formData = new FormData();
    formData.set("id", task.id);
    formData.set("priority", e.target.value);
    startTransition(async () => {
      await updateTask(formData);
      router.refresh();
    });
  }

  return (
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
  );
}
