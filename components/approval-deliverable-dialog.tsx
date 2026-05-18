"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Paperclip, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { uploadAttachment } from "@/lib/actions/attachments";
import { markTaskForApproval } from "@/lib/actions/tasks";
import {
  MAX_ATTACHMENT_SIZE,
  ALLOWED_ATTACHMENT_EXTENSIONS,
  ATTACHMENT_ACCEPT,
} from "@/lib/attachments-constants";
import type { Task } from "@/lib/types";

function getExt(fileName: string) {
  return "." + (fileName.split(".").pop()?.toLowerCase() ?? "bin");
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface ApprovalDeliverableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: Pick<Task, "id" | "title"> | null;
  onSaved: () => void;
}

export function ApprovalDeliverableDialog({
  open,
  onOpenChange,
  task,
  onSaved,
}: ApprovalDeliverableDialogProps) {
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [note, setNote] = useState("");
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setStagedFiles([]);
      setNote("");
    }
  }, [open]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    const valid: File[] = [];
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_SIZE) {
        toast.error(`${file.name} exceeds the 25 MB limit`);
        continue;
      }
      if (!ALLOWED_ATTACHMENT_EXTENSIONS.has(getExt(file.name))) {
        toast.error(`${file.name}: file type not allowed`);
        continue;
      }
      valid.push(file);
    }
    setStagedFiles((prev) => [...prev, ...valid]);
  }

  function removeStaged(idx: number) {
    setStagedFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleSave() {
    if (!task) return;
    startTransition(async () => {
      let uploaded = 0;
      for (const file of stagedFiles) {
        const fd = new FormData();
        fd.set("task_id", task.id);
        fd.set("file", file);
        fd.set("is_deliverable", "true");
        const result = await uploadAttachment(fd);
        if (result.error) {
          toast.error(`Failed to upload ${file.name}: ${result.error}`);
        } else {
          uploaded++;
        }
      }

      if (stagedFiles.length > 0 && uploaded < stagedFiles.length) {
        toast.warning(`${uploaded} of ${stagedFiles.length} files uploaded`);
      }

      const result = await markTaskForApproval(task.id, {
        note: note.trim() || null,
      });

      if ("error" in result) {
        toast.error(result.error);
        return;
      }

      toast.success("Submitted for approval");
      onSaved();
    });
  }

  function handleSkip() {
    if (!task) return;
    startTransition(async () => {
      const result = await markTaskForApproval(task.id, { note: null });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      onSaved();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Submit for Approval</DialogTitle>
          {task && (
            <DialogDescription>
              &ldquo;{task.title}&rdquo; &mdash; attach the end result (PDF, HTML, screenshots, or text) for the operator to review.
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="px-6 py-4 space-y-5">
          {/* File picker */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                <Paperclip className="h-3 w-3" />
                Attachments
              </p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isPending}
                className="text-xs text-neutral-400 hover:text-neutral-700 transition-colors disabled:opacity-50"
              >
                + Add files
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ATTACHMENT_ACCEPT}
              className="hidden"
              onChange={handleFileChange}
            />
            {stagedFiles.length === 0 ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isPending}
                className="w-full rounded-lg border border-dashed border-neutral-200 py-4 text-center text-xs text-neutral-400 hover:border-neutral-300 hover:text-neutral-600 transition-colors disabled:opacity-50"
              >
                Click to attach files (PDF, HTML, screenshots, text, etc.)
              </button>
            ) : (
              <ul className="space-y-1.5">
                {stagedFiles.map((file, idx) => (
                  <li
                    key={idx}
                    className="flex items-center justify-between gap-2 rounded-md border border-neutral-100 bg-neutral-50 px-2.5 py-1.5 text-xs"
                  >
                    <span className="truncate font-medium text-neutral-700">{file.name}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-neutral-400">{formatBytes(file.size)}</span>
                      <button
                        type="button"
                        onClick={() => removeStaged(idx)}
                        disabled={isPending}
                        className="rounded p-0.5 text-neutral-400 hover:text-red-500 transition-colors"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isPending}
                    className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors"
                  >
                    + Add more
                  </button>
                </li>
              </ul>
            )}
          </div>

          {/* Note */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Note</p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note for the operator…"
              maxLength={2000}
              disabled={isPending}
              rows={2}
              className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm text-neutral-700 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:ring-offset-1 disabled:opacity-40 resize-none"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button variant="outline" onClick={handleSkip} disabled={isPending}>
            Skip
          </Button>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? "Submitting…" : "Submit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
