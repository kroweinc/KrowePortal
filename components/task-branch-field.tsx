"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GitBranch, Pencil } from "lucide-react";
import { toast } from "sonner";
import { setTaskBranch } from "@/lib/actions/tasks";
import {
  addLocalBranch,
  removeLocalBranch,
  getEngagementBranchesCached,
  refreshEngagementBranches,
  type EngagementBranch,
  type PreloadedBranches,
} from "@/lib/actions/get-engagement-branches";
import { BranchChipPicker } from "@/components/branch-chip-picker";

interface Props {
  taskId: string;
  branch: string | null;
  // Operators view deliverables read-only.
  readOnly?: boolean;
  // Branches preloaded by the server page (the cached repo branch list) so the
  // chips paint instantly with no fetch. Falls back to a lazy cached read.
  preloaded?: PreloadedBranches;
}

/**
 * Shows (and, for builders, edits) the feature branch a done task is filed
 * under — the key the staging view groups by. Editing swaps the pill for
 * one-click branch chips; picking the repo's default branch also marks the task
 * pushed to main, keeping the staged/shipped split correct.
 */
export function TaskBranchField({ taskId, branch, readOnly, preloaded }: Props) {
  const router = useRouter();
  const preloadedReady = !!preloaded && preloaded.branches.length > 0;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string | null>(branch);
  const [branches, setBranches] = useState<EngagementBranch[]>(
    preloaded?.branches ?? []
  );
  const [defaultBranch, setDefaultBranch] = useState<string | null>(
    preloaded?.defaultBranch ?? null
  );
  const [state, setState] = useState<"idle" | "loading" | "ready" | "no_repo">(
    preloadedReady ? "ready" : "idle"
  );
  const [refreshing, setRefreshing] = useState(false);
  const [isPending, startTransition] = useTransition();

  function openEditor() {
    setEditing(true);
    if (state === "loading") return;
    // Paint whatever we already have, but always reconcile against the repo:
    // the preloaded list is a snapshot from the last server render, so a branch
    // deleted on GitHub since then would otherwise stay clickable indefinitely.
    const hadList = state === "ready";
    if (!hadList) setState("loading");
    getEngagementBranchesCached(taskId)
      .then((res) => {
        if (!res.hasRepo || res.branches.length === 0) {
          if (!hadList) setState("no_repo");
          return;
        }
        setBranches(res.branches);
        setDefaultBranch(res.defaultBranch);
        setState("ready");
      })
      .catch(() => {
        if (!hadList) setState("no_repo");
      });
  }

  function handleSelect(next: string | null, pushedToMain: boolean) {
    setValue(next);
    startTransition(async () => {
      const res = await setTaskBranch(taskId, next, pushedToMain);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  // Same escape hatch the deliverable dialogs have: file a task under a branch
  // that only exists on the builder's machine. Selecting it (and so saving it
  // onto the task) is the picker's job — these just keep the chips in sync.
  async function handleAddBranch(name: string): Promise<string | null> {
    try {
      const res = await addLocalBranch(taskId, name);
      if ("error" in res) return res.error;
      setBranches(res.branches);
      setDefaultBranch(res.defaultBranch);
      setState("ready");
      return null;
    } catch {
      return "Couldn't add that branch. Try again.";
    }
  }

  async function handleRemoveBranch(name: string): Promise<string | null> {
    try {
      const res = await removeLocalBranch(taskId, name);
      if ("error" in res) return res.error;
      setBranches(res.branches);
      return null;
    } catch {
      return "Couldn't remove that branch. Try again.";
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const res = await refreshEngagementBranches(taskId);
      if (res.hasRepo && res.branches.length > 0) {
        setBranches(res.branches);
        setDefaultBranch(res.defaultBranch);
      }
    } catch {
      // keep the current list on failure
    } finally {
      setRefreshing(false);
    }
  }

  if (editing && !readOnly) {
    return (
      <div className="krowe-branch-field">
        {state === "loading" && (
          <span className="krowe-branch-hint">Loading branches…</span>
        )}
        {state === "no_repo" && (
          <span className="krowe-branch-hint">
            No repo linked for this engagement.
          </span>
        )}
        {state === "ready" && (
          <BranchChipPicker
            branches={branches}
            defaultBranch={defaultBranch}
            value={value}
            onChange={handleSelect}
            disabled={isPending}
            onRefresh={handleRefresh}
            refreshing={refreshing}
            onAddBranch={handleAddBranch}
            onRemoveBranch={handleRemoveBranch}
          />
        )}
        <button
          type="button"
          className="krowe-branch-cancel"
          onClick={() => setEditing(false)}
          disabled={isPending}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="krowe-branch-field">
      <span className="krowe-branch-pill" data-empty={branch ? undefined : "true"}>
        <GitBranch className="h-3.5 w-3.5" />
        {branch ?? "No branch"}
      </span>
      {!readOnly && (
        <button type="button" className="krowe-branch-edit" onClick={openEditor}>
          <Pencil className="h-3 w-3" />
          {branch ? "Change" : "Set branch"}
        </button>
      )}
    </div>
  );
}
