"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteTask } from "@/lib/actions/tasks";

interface DeleteTaskButtonProps {
  taskId: string;
  taskTitle: string;
  variant?: "icon" | "full" | "ghost";
  redirectTo?: string;
  onSuccess?: () => void;
}

export function DeleteTaskButton({
  taskId,
  taskTitle,
  variant = "icon",
  redirectTo,
  onSuccess,
}: DeleteTaskButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (!window.confirm(`Delete "${taskTitle}"? This cannot be undone.`)) return;
    startTransition(async () => {
      const result = await deleteTask(taskId);
      if (result?.error) {
        window.alert(`Delete failed: ${result.error}`);
        return;
      }
      if (onSuccess) {
        onSuccess();
        router.refresh();
      } else if (redirectTo) {
        router.push(redirectTo);
      } else {
        router.refresh();
      }
    });
  }

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        title="Delete task"
        className="text-neutral-400 hover:text-red-600 transition-colors disabled:opacity-50"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    );
  }

  if (variant === "ghost") {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="krowe-btn-pill ghost-danger"
      >
        <Trash2 className="h-3.5 w-3.5" />
        {isPending ? "Deleting…" : "Delete task"}
      </button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handleClick}
      disabled={isPending}
      className="w-full text-red-600 hover:bg-red-50"
    >
      {isPending ? "Deleting…" : "Delete task"}
    </Button>
  );
}
