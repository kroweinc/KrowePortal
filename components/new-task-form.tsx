"use client";

import { useRef, useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { createTask } from "@/lib/actions/tasks";

interface NewTaskFormProps {
  engagementId?: string;
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

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {expanded && (
        <div className="w-80 rounded-xl border border-neutral-200 bg-white shadow-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-neutral-900">New task</span>
            <button
              onClick={() => { setExpanded(false); setError(null); }}
              className="text-neutral-400 hover:text-neutral-700 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <form ref={formRef} action={handleSubmit} className="space-y-3">
            {engagementId && <input type="hidden" name="engagement_id" value={engagementId} />}
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
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">Priority</label>
              <Select name="priority" defaultValue="medium">
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </Select>
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <Button type="submit" size="sm" className="w-full" disabled={isPending}>
              {isPending ? "Adding…" : "Add task"}
            </Button>
          </form>
        </div>
      )}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-900 text-white shadow-lg hover:bg-neutral-700 transition-colors"
        aria-label="New task"
      >
        <Plus className="h-5 w-5" />
      </button>
    </div>
  );
}
