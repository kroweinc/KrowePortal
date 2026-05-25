"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Paperclip, X, GitBranch } from "lucide-react";
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
import { markTaskDone } from "@/lib/actions/tasks";
import { linkTaskCommit } from "@/lib/actions/task-commits";
import {
  MAX_ATTACHMENT_SIZE,
  ALLOWED_ATTACHMENT_EXTENSIONS,
  ATTACHMENT_ACCEPT,
} from "@/lib/attachments-constants";
import type { Task } from "@/lib/types";
import { CommitPicker, type PickedCommit } from "@/components/done-deliverable-dialog/commit-picker";

function getExt(fileName: string) {
  return "." + (fileName.split(".").pop()?.toLowerCase() ?? "bin");
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface DoneDeliverableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: Pick<Task, "id" | "title"> | null;
  onSaved: () => void;
}

export function DoneDeliverableDialog({
  open,
  onOpenChange,
  task,
  onSaved,
}: DoneDeliverableDialogProps) {
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [pushedToMain, setPushedToMain] = useState(false);
  const [note, setNote] = useState("");
  const [pickedCommits, setPickedCommits] = useState<PickedCommit[]>([]);
  const [showNoteFallback, setShowNoteFallback] = useState(false);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setStagedFiles([]);
      setPushedToMain(false);
      setNote("");
      setPickedCommits([]);
      setShowNoteFallback(false);
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

      const result = await markTaskDone(task.id, {
        pushed_to_main: pushedToMain || pickedCommits.length > 0,
        completion_note: note.trim() || null,
      });

      if ("error" in result) {
        toast.error(result.error);
        return;
      }

      if (pushedToMain && pickedCommits.length > 0) {
        let linked = 0;
        for (const commit of pickedCommits) {
          const linkResult = await linkTaskCommit(task.id, {
            sha: commit.sha,
            url: commit.html_url,
            message: commit.message,
            author_name: commit.author_name,
            author_login: commit.author_login,
            committed_at: commit.committed_at,
            repo_full_name: commit.repo_full_name,
          });
          if ("error" in linkResult) {
            toast.error(`Couldn't link ${commit.short_sha}: ${linkResult.error}`);
          } else {
            linked++;
          }
        }
        if (linked < pickedCommits.length) {
          toast.warning(`${linked} of ${pickedCommits.length} commits linked`);
        }
      }

      toast.success("Task marked as done");
      onSaved();
    });
  }

  function handleSkip() {
    if (!task) return;
    startTransition(async () => {
      const result = await markTaskDone(task.id, {
        pushed_to_main: false,
        completion_note: null,
      });
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
          <DialogTitle>Mark as done</DialogTitle>
          {task && (
            <DialogDescription>
              &ldquo;{task.title}&rdquo; &mdash; optionally attach the deliverable or note where it shipped.
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
                Click to attach files (screenshots, docs, etc.)
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

          {/* Pushed to main */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Deliverable</p>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={pushedToMain}
                onChange={(e) => {
                  setPushedToMain(e.target.checked);
                  if (!e.target.checked) {
                    setNote("");
                    setPickedCommits([]);
                    setShowNoteFallback(false);
                  }
                }}
                disabled={isPending}
                className="h-4 w-4 rounded border-neutral-300"
              />
              <span className="flex items-center gap-1.5 text-sm text-neutral-700">
                <GitBranch className="h-3.5 w-3.5" />
                Pushed to main
              </span>
            </label>

            {pushedToMain && task && (
              <>
                <CommitPicker
                  taskId={task.id}
                  selected={pickedCommits}
                  onChange={setPickedCommits}
                  disabled={isPending}
                />

                {!showNoteFallback ? (
                  <button
                    type="button"
                    onClick={() => setShowNoteFallback(true)}
                    disabled={isPending}
                    className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors disabled:opacity-50"
                  >
                    + Or paste a note instead
                  </button>
                ) : (
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. PR #123, commit abc123"
                    maxLength={2000}
                    disabled={isPending}
                    rows={2}
                    className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm text-neutral-700 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:ring-offset-1 disabled:opacity-40 resize-none"
                  />
                )}
              </>
            )}
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
            {isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
