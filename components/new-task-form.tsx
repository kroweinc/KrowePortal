"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createTask } from "@/lib/actions/tasks";

interface NewTaskFormProps {
  engagementId: string;
  placeholder?: string;
  onSuccess?: () => void;
}

export function NewTaskForm({ engagementId, placeholder, onSuccess }: NewTaskFormProps) {
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await createTask(formData);
      if (result?.error) {
        setError(result.error);
      } else {
        formRef.current?.reset();
        setExpanded(false);
        setError(null);
        onSuccess?.();
      }
    });
  }

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full rounded-lg border border-dashed border-neutral-300 py-3 text-sm text-neutral-400 hover:border-neutral-400 hover:text-neutral-600 transition-colors"
      >
        + Describe a new need
      </button>
    );
  }

  return (
    <form ref={formRef} action={handleSubmit} className="rounded-lg border border-neutral-200 bg-white p-4 space-y-3 shadow-sm">
      <input type="hidden" name="engagement_id" value={engagementId} />
      <Input
        name="title"
        placeholder={placeholder ?? "What needs to be built or fixed?"}
        required
        autoFocus
      />
      <Textarea
        name="description"
        placeholder="More context (optional)"
        rows={3}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Adding…" : "Add task"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => { setExpanded(false); setError(null); }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
