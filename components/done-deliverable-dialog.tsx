"use client";

import { useState, useEffect, useRef } from "react";
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
import {
  addLocalBranch,
  removeLocalBranch,
  getEngagementBranchesCached,
  refreshEngagementBranches,
  type EngagementBranch,
  type PreloadedBranches,
} from "@/lib/actions/get-engagement-branches";
import { BranchChipPicker } from "@/components/branch-chip-picker";
import {
  isDefaultBranch,
  reconcileBranch,
  type PickedBranch,
} from "@/lib/tasks/staging-grouping";
import type { DonePayload } from "@/lib/tasks/commit-done-deliverable";
import {
  MAX_ATTACHMENT_SIZE,
  ALLOWED_ATTACHMENT_EXTENSIONS,
  ATTACHMENT_ACCEPT,
} from "@/lib/attachments-constants";
import { isCodeWork } from "@/lib/utils";
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
  task: Pick<Task, "id" | "title" | "engagement_id" | "branch_name" | "work_kind"> | null;
  // Server-preloaded branch list for the task's engagement, so the picker paints
  // instantly with no on-open fetch. Falls back to the cached fetch when absent.
  preloaded?: PreloadedBranches;
  // Fires the moment Save/Skip is clicked with a snapshot of everything the
  // dialog collected. The caller closes the dialog and commits in the
  // background, so there's no "Saving…" wait here.
  onSubmit: (payload: DonePayload) => void;
}

export function DoneDeliverableDialog({
  open,
  onOpenChange,
  task,
  preloaded,
  onSubmit,
}: DoneDeliverableDialogProps) {
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [note, setNote] = useState("");
  const [pickedCommits, setPickedCommits] = useState<PickedCommit[]>([]);
  const [showNoteFallback, setShowNoteFallback] = useState(false);
  // Branch is null = "No branch". Selecting the repo's default branch counts as
  // "pushed to main" — see pushedToMain below.
  const [branch, setBranch] = useState<string | null>(null);
  const [defaultBranch, setDefaultBranch] = useState<string | null>(null);
  const [branches, setBranches] = useState<EngagementBranch[]>([]);
  const [branchState, setBranchState] =
    useState<"idle" | "loading" | "ready" | "no_repo">("idle");
  // For no-repo tasks (personal / unlinked) there's no branch to imply "pushed
  // to main", so keep an explicit toggle for that case.
  const [noRepoPushed, setNoRepoPushed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // What the builder has picked so far — the on-open revalidation must not
  // stomp a branch they already chose.
  const pickedRef = useRef<PickedBranch>({ picked: false, value: null });

  // Non-code work (a question asked, an email sent — migration 0089) has no
  // branch and no commits, so the whole code-shaped half of this dialog stays
  // out of the way. Tasks that were never asked read as code.
  const codeWork = !task || isCodeWork(task);
  // The effects below key on these primitives, never on `task` itself — a new
  // task object with the same id (a router refresh while the dialog is open)
  // must not re-run the reset and wipe a half-written note.
  const taskId = task?.id ?? null;
  const taskBranch = task?.branch_name ?? null;
  const branchIsDefault = isDefaultBranch(branch, defaultBranch);
  const pushedToMain = !codeWork
    ? false
    : branchState === "no_repo"
      ? noRepoPushed
      : branchIsDefault;

  useEffect(() => {
    if (open) {
      setStagedFiles([]);
      setNote("");
      setPickedCommits([]);
      setShowNoteFallback(false);
      // A branch chosen back at approval is a deliberate pick — start from it
      // instead of snapping to main, which would silently re-file the work.
      setBranch(taskBranch);
      setDefaultBranch(null);
      setBranches([]);
      setBranchState("idle");
      setNoRepoPushed(false);
      setRefreshing(false);
      pickedRef.current = taskBranch
        ? { picked: true, value: taskBranch }
        : { picked: false, value: null };
    }
  }, [open, taskId, taskBranch]);

  // Load the engagement repo's branches so the deliverable can be filed under
  // the branch it shipped on — the repo default is pre-selected, which counts as
  // "pushed to main". Degrades to a hidden picker when the task has no repo.
  useEffect(() => {
    if (!open || !taskId || !codeWork) return;

    // Instant paint: when the server preheated this engagement's cached branch
    // list, hydrate straight from it — no fetch, no "Loading branches…" flash.
    const snapshot = preloaded && preloaded.branches.length > 0 ? preloaded : null;
    if (snapshot) {
      setBranches(snapshot.branches);
      setDefaultBranch(snapshot.defaultBranch);
      // Default to "main" so the common case is one click away — but never over
      // a deliberate pick (named at approval, or clicked since this opened), so
      // a fresh snapshot arriving mid-dialog can't re-file the work.
      if (!pickedRef.current.picked) setBranch(snapshot.defaultBranch);
      setBranchState("ready");
    } else {
      setBranchState("loading");
    }

    // ...then always reconcile against the repo. The preloaded list is a
    // snapshot from whenever the page last rendered, so a branch deleted on
    // GitHub since then would otherwise stay clickable for the life of the tab.
    let cancelled = false;
    getEngagementBranchesCached(taskId)
      .then((res) => {
        if (cancelled) return;
        if (!res.hasRepo || res.branches.length === 0) {
          // Only downgrade to the no-repo toggle if we had nothing to show; a
          // failed reconcile shouldn't tear down a list already on screen.
          if (!snapshot) setBranchState("no_repo");
          return;
        }
        setBranches(res.branches);
        setDefaultBranch(res.defaultBranch);
        const { branch: next, dropped } = reconcileBranch(pickedRef.current, res);
        setBranch(next);
        if (dropped) {
          // Their pick was deleted on GitHub between the page render and now.
          // Say so — silently moving the selection would file the deliverable
          // somewhere they didn't choose.
          pickedRef.current = { picked: true, value: next };
          toast.info(
            `Branch "${dropped}" no longer exists on GitHub — switched to ${next ?? "no branch"}.`
          );
        }
        setBranchState("ready");
      })
      .catch(() => {
        if (!cancelled && !snapshot) setBranchState("no_repo");
      });
    return () => {
      cancelled = true;
    };
  }, [open, taskId, codeWork, preloaded]);

  function selectBranch(next: string | null, pushed: boolean) {
    pickedRef.current = { picked: true, value: next };
    setBranch(next);
    // Leaving the default branch clears the pushed-to-main extras.
    if (!pushed) {
      setPickedCommits([]);
      setShowNoteFallback(false);
    }
  }

  // Name a branch GitHub has never seen — the branch a solo builder has been
  // committing to without ever pushing it. It behaves like any other chip until
  // the push, at which point the sync folds it into the real branch.
  async function handleAddBranch(name: string): Promise<string | null> {
    if (!task) return "No task selected.";
    try {
      const res = await addLocalBranch(task.id, name);
      if ("error" in res) return res.error;
      setBranches(res.branches);
      setDefaultBranch(res.defaultBranch);
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
        setDefaultBranch(res.defaultBranch);
        const { branch: next, dropped } = reconcileBranch(pickedRef.current, res);
        setBranch(next);
        if (dropped) {
          pickedRef.current = { picked: true, value: next };
          toast.info(
            `Branch "${dropped}" no longer exists on GitHub — switched to ${next ?? "no branch"}.`
          );
        }
      }
    } catch {
      // keep the current list on failure
    } finally {
      setRefreshing(false);
    }
  }

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

  // Save/Skip just hand a snapshot to the caller, which closes the dialog and
  // commits in the background. No await here — that's what makes it feel instant.
  function handleSave() {
    if (!task) return;
    onSubmit({
      core: {
        pushed_to_main: pushedToMain || pickedCommits.length > 0,
        completion_note: note.trim() || null,
        branch_name: branch,
      },
      files: stagedFiles,
      commits: pickedCommits,
      linkCommits: pushedToMain,
    });
  }

  function handleSkip() {
    if (!task) return;
    onSubmit({
      core: {
        pushed_to_main: false,
        completion_note: null,
        branch_name: branch,
      },
      files: [],
      commits: [],
      linkCommits: false,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark as done</DialogTitle>
          {task && (
            <DialogDescription>
              &ldquo;{task.title}&rdquo; &mdash;{" "}
              {codeWork
                ? "optionally attach the deliverable or note where it shipped."
                : "optionally attach anything that shows it happened, or just say what came of it."}
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
                className="text-xs text-neutral-400 hover:text-neutral-700 transition-colors"
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
                className="w-full rounded-lg border border-dashed border-neutral-200 py-4 text-center text-xs text-neutral-400 hover:border-neutral-300 hover:text-neutral-600 transition-colors"
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
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              {codeWork ? "Deliverable" : "Outcome"}
            </p>

            {/* Branch: one-click chips. The repo default (main) is pre-selected
                and counts as "pushed to main"; other branches stage for the next
                push. Falls back to a Shipped/Not-yet toggle when there's no repo. */}
            {codeWork && branchState === "loading" && (
              <p className="text-xs text-neutral-400">Loading branches…</p>
            )}
            {codeWork && branchState === "ready" && (
              <div className="space-y-1">
                <p className="flex items-center gap-1.5 text-xs text-neutral-600">
                  <GitBranch className="h-3.5 w-3.5" />
                  Branch
                </p>
                <BranchChipPicker
                  branches={branches}
                  defaultBranch={defaultBranch}
                  value={branch}
                  onChange={selectBranch}
                  onRefresh={handleRefreshBranches}
                  refreshing={refreshing}
                  onAddBranch={handleAddBranch}
                  onRemoveBranch={handleRemoveBranch}
                />
              </div>
            )}

            {codeWork && branchState === "no_repo" && (
              <div
                className="krowe-branch-chips"
                role="group"
                aria-label="Delivery status"
              >
                <button
                  type="button"
                  className={`krowe-branch-chip is-default${noRepoPushed ? " active" : ""}`}
                  aria-pressed={noRepoPushed}
                  onClick={() => setNoRepoPushed(true)}
                >
                  <GitBranch className="h-3.5 w-3.5" />
                  Shipped
                </button>
                <button
                  type="button"
                  className={`krowe-branch-chip is-none${!noRepoPushed ? " active" : ""}`}
                  aria-pressed={!noRepoPushed}
                  onClick={() => {
                    setNoRepoPushed(false);
                    setPickedCommits([]);
                    setShowNoteFallback(false);
                  }}
                >
                  Not yet
                </button>
              </div>
            )}

            {pushedToMain && task && (
              <>
                <CommitPicker
                  taskId={task.id}
                  selected={pickedCommits}
                  onChange={setPickedCommits}
                />

                {!showNoteFallback && (
                  <button
                    type="button"
                    onClick={() => setShowNoteFallback(true)}
                    className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors"
                  >
                    + Or paste a note instead
                  </button>
                )}
              </>
            )}

            {/* A completion note is always available — a non-code deliverable
                (Figma, doc, demo link) shouldn't require faking a push to main. */}
            {(!pushedToMain || showNoteFallback) && (
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  codeWork
                    ? "What did you deliver? e.g. PR #123, a Figma link, or a short note"
                    : "What came of it? e.g. Dana confirmed the 25th — invoicing updated"
                }
                maxLength={2000}
                rows={2}
                className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm text-neutral-700 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:ring-offset-1 resize-none"
              />
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="outline" onClick={handleSkip}>
            Skip
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
