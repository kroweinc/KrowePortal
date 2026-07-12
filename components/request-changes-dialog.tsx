"use client";

import { useState, useTransition, useEffect } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { requestTaskChanges } from "@/lib/actions/tasks";
import type { Task } from "@/lib/types";

interface RequestChangesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: Pick<Task, "id" | "title"> | null;
  builderName: string;
  onSaved: () => void;
}

/** Operator send-back: returns a submitted task to the builder with an
 *  optional note. Counterpart to the builder's ApprovalDeliverableDialog. */
export function RequestChangesDialog({
  open,
  onOpenChange,
  task,
  builderName,
  onSaved,
}: RequestChangesDialogProps) {
  const [note, setNote] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (open) setNote("");
  }, [open]);

  function handleSend() {
    if (!task) return;
    startTransition(async () => {
      const trimmed = note.trim();
      const result = await requestTaskChanges(task.id, { note: trimmed || null });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        trimmed
          ? `Sent back to ${builderName} with your notes`
          : `Sent back to ${builderName} for changes`
      );
      onSaved();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request Changes</DialogTitle>
          {task && (
            <DialogDescription>
              &ldquo;{task.title}&rdquo; &mdash; this moves the task back to In
              Progress so {builderName} can pick it up again.
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="px-6 py-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Note</p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={`What should ${builderName} change? (optional)`}
            maxLength={2000}
            disabled={isPending}
            rows={3}
            className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm text-neutral-700 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:ring-offset-1 disabled:opacity-40 resize-none"
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={isPending}>
            {isPending ? "Sending…" : `Send back to ${builderName}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
