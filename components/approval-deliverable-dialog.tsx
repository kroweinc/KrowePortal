"use client";

import { useState, useTransition, useEffect, useRef, useCallback } from "react";
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
import { markTaskForApproval } from "@/lib/actions/tasks";
import {
  addLocalBranch,
  removeLocalBranch,
  getEngagementBranchesCached,
  refreshEngagementBranches,
  type EngagementBranch,
  type PreloadedBranches,
} from "@/lib/actions/get-engagement-branches";
import { BranchChipPicker } from "@/components/branch-chip-picker";
import { WORK_KIND_ICONS } from "@/components/task-type-badge";
import { reconcileBranch, type PickedBranch } from "@/lib/tasks/staging-grouping";
import {
  MAX_ATTACHMENT_SIZE,
  ALLOWED_ATTACHMENT_EXTENSIONS,
  ATTACHMENT_ACCEPT,
} from "@/lib/attachments-constants";
import { WORK_KINDS, type Task, type WorkKind } from "@/lib/types";
import { WORK_KIND_LABELS } from "@/lib/utils";

function getExt(fileName: string) {
  return "." + (fileName.split(".").pop()?.toLowerCase() ?? "bin");
}

/** Screenshots land on the clipboard as a nameless (or generic "image.png")
 *  blob, so give pasted images a unique, correctly-suffixed name. Named files
 *  copied from disk keep their own name. */
function pastedImageName(file: File, index: number): string {
  const original = file.name?.trim();
  const usable =
    original &&
    original.toLowerCase() !== "image.png" &&
    ALLOWED_ATTACHMENT_EXTENSIONS.has(getExt(original));
  if (usable) return original;
  const sub = file.type.split("/")[1] ?? "png";
  const ext = sub === "svg+xml" ? "svg" : sub === "jpeg" ? "jpg" : sub;
  return `pasted-image-${Date.now()}-${index + 1}.${ext}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Per-kind copy. Only "code" ends in a branch — the rest of the dialog stops
 * talking about deliverables and just asks what the builder actually did, so a
 * task like "ask the client about their billing cutoff" doesn't have to be
 * dressed up as a shipped artifact.
 */
const WORK_KIND_COPY: Record<
  WorkKind,
  { blurb: string; noteLabel: string; notePlaceholder: string; attachHint: string }
> = {
  code: {
    blurb: "attach the end result and say which branch it lives on.",
    noteLabel: "Note",
    notePlaceholder: "Optional note for the operator…",
    attachHint: "Click to attach files, or paste a screenshot (⌘V)",
  },
  question: {
    blurb: "no branch needed. Say what you asked, and who you asked.",
    noteLabel: "What you did",
    notePlaceholder: "e.g. asked Dana whether invoices cut off on the 25th — reply pending",
    attachHint: "Optional — attach a screenshot of the thread (⌘V)",
  },
  email: {
    blurb: "no branch needed. Say what you sent, and who it went to.",
    noteLabel: "What you did",
    notePlaceholder: "e.g. sent the Q3 pricing summary to Dana, cc'd ops",
    attachHint: "Optional — attach the email or a screenshot (⌘V)",
  },
  other: {
    blurb: "no branch needed. Say what you did.",
    noteLabel: "What you did",
    notePlaceholder: "e.g. booked the kickoff call for Tuesday at 10",
    attachHint: "Optional — attach anything that shows it happened (⌘V)",
  },
};

export type ApprovalTask = Pick<
  Task,
  "id" | "title" | "engagement_id" | "branch_name" | "work_kind"
>;

interface ApprovalDeliverableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: ApprovalTask | null;
  // Server-preloaded branch list for the task's engagement, so the code-kind
  // picker paints instantly with no on-open fetch. Falls back to the cached
  // fetch when absent.
  preloaded?: PreloadedBranches;
  onSaved: () => void;
}

export function ApprovalDeliverableDialog({
  open,
  onOpenChange,
  task,
  preloaded,
  onSaved,
}: ApprovalDeliverableDialogProps) {
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [note, setNote] = useState("");
  const [workKind, setWorkKind] = useState<WorkKind>("code");
  // Branch is null = "No branch". Unlike the done dialog nothing is
  // pre-selected and the repo default carries no privilege here: approval
  // happens BEFORE the work ships, so picking main can't mean "pushed to main".
  const [branch, setBranch] = useState<string | null>(null);
  const [branches, setBranches] = useState<EngagementBranch[]>([]);
  const [branchState, setBranchState] =
    useState<"idle" | "loading" | "ready" | "no_repo">("idle");
  const [refreshing, setRefreshing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // What the builder has picked so far — the on-open revalidation must not
  // stomp a branch they already chose.
  const pickedRef = useRef<PickedBranch>({ picked: false, value: null });

  const copy = WORK_KIND_COPY[workKind];
  const isCode = workKind === "code";
  // The effects below key on these primitives, never on `task` itself — a new
  // task object with the same id (a router refresh while the dialog is open)
  // must not re-run the reset and wipe a half-written note.
  const taskId = task?.id ?? null;
  const taskBranch = task?.branch_name ?? null;
  const taskWorkKind = task?.work_kind ?? null;

  useEffect(() => {
    if (open) {
      setStagedFiles([]);
      setNote("");
      // Resending after an unsend keeps the kind the builder already chose.
      setWorkKind(taskWorkKind ?? "code");
      setBranch(taskBranch);
      setBranches([]);
      setBranchState("idle");
      setRefreshing(false);
      pickedRef.current = taskBranch
        ? { picked: true, value: taskBranch }
        : { picked: false, value: null };
    }
  }, [open, taskId, taskBranch, taskWorkKind]);

  // Load the engagement repo's branches so code work can be filed under the
  // branch it lives on. Only fetched once the builder is actually on the code
  // chip — a question or an email never touches GitHub.
  useEffect(() => {
    if (!open || !taskId || !isCode) return;

    // Instant paint: when the server preheated this engagement's cached branch
    // list, hydrate straight from it — no fetch, no "Loading branches…" flash.
    const snapshot = preloaded && preloaded.branches.length > 0 ? preloaded : null;
    if (snapshot) {
      setBranches(snapshot.branches);
      setBranchState("ready");
    } else {
      setBranchState("loading");
    }

    // ...then always reconcile against the repo, so a branch deleted on GitHub
    // since the page rendered doesn't stay clickable for the life of the tab.
    let cancelled = false;
    getEngagementBranchesCached(taskId)
      .then((res) => {
        if (cancelled) return;
        if (!res.hasRepo || res.branches.length === 0) {
          // Only downgrade to "no repo" if we had nothing to show; a failed
          // reconcile shouldn't tear down a list already on screen.
          if (!snapshot) setBranchState("no_repo");
          return;
        }
        setBranches(res.branches);
        // defaultBranch: null on purpose — nothing is pre-selected and main
        // gets no "pushed" tag, because the work hasn't shipped yet.
        const { branch: next, dropped } = reconcileBranch(pickedRef.current, {
          branches: res.branches,
          defaultBranch: null,
        });
        setBranch(next);
        if (dropped) {
          pickedRef.current = { picked: true, value: next };
          toast.info(`Branch "${dropped}" no longer exists on GitHub — cleared it.`);
        }
        setBranchState("ready");
      })
      .catch(() => {
        if (!cancelled && !snapshot) setBranchState("no_repo");
      });
    return () => {
      cancelled = true;
    };
  }, [open, taskId, preloaded, isCode]);

  function selectWorkKind(next: WorkKind) {
    setWorkKind(next);
    // Leaving code drops the branch — a question or an email has none, and
    // carrying a stale pick through would file it under a branch anyway.
    if (next !== "code") {
      setBranch(null);
      pickedRef.current = { picked: false, value: null };
    }
  }

  function selectBranch(next: string | null) {
    pickedRef.current = { picked: true, value: next };
    setBranch(next);
  }

  // Work on a branch nobody pushed is invisible to GitHub, so the chips can't
  // offer it — and approval is exactly where that bites, since the branch is
  // still local at that point. Both handlers hand the server's fresh list
  // straight back to the chips.
  async function handleAddBranch(name: string): Promise<string | null> {
    if (!task) return "No task selected.";
    try {
      const res = await addLocalBranch(task.id, name);
      if ("error" in res) return res.error;
      setBranches(res.branches);
      setBranchState("ready");
      return null;
    } catch {
      return "Couldn't add that branch. Try again.";
    }
  }

  async function handleRemoveBranch(name: string): Promise<string | null> {
    if (!task) return "No task selected.";
    try {
      const res = await removeLocalBranch(task.id, name);
      if ("error" in res) return res.error;
      setBranches(res.branches);
      return null;
    } catch {
      return "Couldn't remove that branch. Try again.";
    }
  }

  async function handleRefreshBranches() {
    if (!task) return;
    setRefreshing(true);
    try {
      const res = await refreshEngagementBranches(task.id);
      if (res.hasRepo && res.branches.length > 0) {
        setBranches(res.branches);
        const { branch: next, dropped } = reconcileBranch(pickedRef.current, {
          branches: res.branches,
          defaultBranch: null,
        });
        setBranch(next);
        if (dropped) {
          pickedRef.current = { picked: true, value: next };
          toast.info(`Branch "${dropped}" no longer exists on GitHub — cleared it.`);
        }
      }
    } catch {
      // keep the current list on failure
    } finally {
      setRefreshing(false);
    }
  }

  const stageFiles = useCallback((files: File[]) => {
    const valid: File[] = [];
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_SIZE) {
        toast.error(`${file.name || "Pasted image"} exceeds the 25 MB limit`);
        continue;
      }
      if (!ALLOWED_ATTACHMENT_EXTENSIONS.has(getExt(file.name))) {
        toast.error(`${file.name}: file type not allowed`);
        continue;
      }
      valid.push(file);
    }
    if (valid.length) setStagedFiles((prev) => [...prev, ...valid]);
  }, []);

  // Paste-to-attach: while the dialog is open, capture screenshots/images from
  // the clipboard (⌘V) anywhere in the dialog and stage them like picked files.
  // Non-image pastes (e.g. text into the note) fall through untouched.
  useEffect(() => {
    if (!open) return;
    function onPaste(e: ClipboardEvent) {
      const images = Array.from(e.clipboardData?.files ?? []).filter((f) =>
        f.type.startsWith("image/")
      );
      if (images.length === 0) return;
      e.preventDefault();
      stageFiles(images.map((file, i) => new File([file], pastedImageName(file, i), { type: file.type })));
      toast.success(images.length === 1 ? "Image pasted" : `${images.length} images pasted`);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [open, stageFiles]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    stageFiles(files);
  }

  function removeStaged(idx: number) {
    setStagedFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  function submit(payload: { note: string | null; files: File[] }) {
    if (!task) return;
    startTransition(async () => {
      let uploaded = 0;
      for (const file of payload.files) {
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

      if (payload.files.length > 0 && uploaded < payload.files.length) {
        toast.warning(`${uploaded} of ${payload.files.length} files uploaded`);
      }

      const result = await markTaskForApproval(task.id, {
        note: payload.note,
        workKind,
        // Only code work carries a branch, and only once the picker actually
        // has a repo behind it — otherwise leave whatever the task already had.
        branchName: isCode && branchState === "ready" ? branch : undefined,
      });

      if ("error" in result) {
        toast.error(result.error);
        return;
      }

      toast.success("Submitted for approval");
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
              &ldquo;{task.title}&rdquo; &mdash; {copy.blurb}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="px-6 py-4 space-y-5">
          {/* What kind of work — reframes the rest of the dialog. Not every task
              ends in a branch; a question or an email is a real deliverable. */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              What kind of work
            </p>
            <div
              className="krowe-workkind-chips"
              role="group"
              aria-label="What kind of work"
            >
              {WORK_KINDS.map((kind) => {
                const Icon = WORK_KIND_ICONS[kind];
                const active = workKind === kind;
                return (
                  <button
                    key={kind}
                    type="button"
                    className={`krowe-workkind-chip${active ? " active" : ""}`}
                    aria-pressed={active}
                    disabled={isPending}
                    onClick={() => selectWorkKind(kind)}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {WORK_KIND_LABELS[kind]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Branch — code only, and never pre-selected: approval happens before
              the push, so the repo default earns no "pushed to main" meaning. */}
          {isCode && branchState !== "no_repo" && (
            <div className="space-y-1">
              <p className="flex items-center gap-1.5 text-xs text-neutral-600">
                <GitBranch className="h-3.5 w-3.5" />
                Branch
              </p>
              {branchState === "ready" ? (
                <BranchChipPicker
                  branches={branches}
                  defaultBranch={null}
                  value={branch}
                  onChange={selectBranch}
                  onRefresh={handleRefreshBranches}
                  refreshing={refreshing}
                  onAddBranch={handleAddBranch}
                  onRemoveBranch={handleRemoveBranch}
                  disabled={isPending}
                />
              ) : (
                <p className="text-xs text-neutral-400">Loading branches…</p>
              )}
            </div>
          )}

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
                {copy.attachHint}
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

          {/* Note — for non-code work this IS the deliverable, so it's labelled
              as the thing that happened rather than as an optional aside. */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              {copy.noteLabel}
            </p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={copy.notePlaceholder}
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
          <Button
            variant="outline"
            onClick={() => submit({ note: null, files: [] })}
            disabled={isPending}
          >
            Skip
          </Button>
          <Button
            onClick={() => submit({ note: note.trim() || null, files: stagedFiles })}
            disabled={isPending}
          >
            {isPending ? "Submitting…" : "Submit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
