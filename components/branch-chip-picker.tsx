"use client";

import { useState } from "react";
import { GitBranch, Plus, RotateCw, X } from "lucide-react";
import type { EngagementBranch } from "@/lib/actions/get-engagement-branches";
import { isDefaultBranch } from "@/lib/tasks/staging-grouping";
import { MAX_BRANCH_NAME_LENGTH, validateBranchName } from "@/lib/tasks/local-branches";

interface BranchChipPickerProps {
  branches: EngagementBranch[];
  // The repo's default branch (usually "main"). Selecting it counts as
  // "pushed to main"; it's rendered first and pre-selected by the callers.
  defaultBranch: string | null;
  // Selected branch name; null = "No branch".
  value: string | null;
  // Fires with the chosen branch and whether that branch is the default —
  // callers persist that as pushed_to_main.
  onChange: (branch: string | null, pushedToMain: boolean) => void;
  disabled?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  // Record a branch GitHub has never seen. Resolves to an error message, or null
  // on success — the caller repaints `branches` from the server's fresh list.
  // Absent = no add affordance.
  onAddBranch?: (name: string) => Promise<string | null>;
  // Drop a hand-added branch (typo insurance). Only ever offered on chips
  // flagged `local`; GitHub's own branches are not the picker's to delete.
  onRemoveBranch?: (name: string) => Promise<string | null>;
}

/**
 * One-click branch chips that replace the old branch dropdown + "Pushed to
 * main" checkbox. The default branch is the front chip and, when picked, marks
 * the task pushed to main (green, "shipped"); any other branch is staged for
 * the next push (amber); "No branch" opts out of branch grouping.
 *
 * The chips are built from what GitHub lists, which leaves out the branch a
 * builder is working on right now and hasn't pushed. "Add branch" records that
 * one by hand (migration 0091) — it behaves like any other chip, wears a "local"
 * tag so nobody mistakes it for something on the repo, and folds into the real
 * branch on the sync after the push.
 */
export function BranchChipPicker({
  branches,
  defaultBranch,
  value,
  onChange,
  disabled,
  onRefresh,
  refreshing,
  onAddBranch,
  onRemoveBranch,
}: BranchChipPickerProps) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Guarantee the default branch is always an option even if the graph didn't
  // surface it, so "main" is always one click away.
  const names = branches.map((b) => b.name);
  const list: EngagementBranch[] =
    defaultBranch && !names.includes(defaultBranch)
      ? [{ name: defaultBranch, purpose: null, local: false }, ...branches]
      : branches;

  const selected = value !== null ? branches.find((b) => b.name === value) : undefined;
  const hint =
    value === null
      ? "No branch — won't show under a branch group."
      : selected?.local
        ? "Not on GitHub yet — it'll merge with the real branch once you push."
        : value === defaultBranch
          ? "On the default branch — marks this as pushed to main."
          : "Staged for the next push.";

  function closeAdd() {
    setAdding(false);
    setDraft("");
    setAddError(null);
  }

  async function submitAdd() {
    if (!onAddBranch || busy) return;
    const checked = validateBranchName(draft);
    if ("error" in checked) {
      setAddError(checked.error);
      return;
    }
    setBusy(true);
    const error = await onAddBranch(checked.name);
    setBusy(false);
    if (error) {
      setAddError(error);
      return;
    }
    // The branch they just named is the branch they meant — select it.
    onChange(checked.name, isDefaultBranch(checked.name, defaultBranch));
    closeAdd();
  }

  async function removeBranch(name: string) {
    if (!onRemoveBranch || busy) return;
    setBusy(true);
    const error = await onRemoveBranch(name);
    setBusy(false);
    if (error) {
      setAddError(error);
      return;
    }
    // Clear a selection that just stopped existing rather than submitting a
    // deliverable against a branch the picker no longer offers.
    if (value === name) onChange(null, false);
  }

  return (
    <div className="krowe-branch-chips-wrap">
      <div className="krowe-branch-chips" role="group" aria-label="Branch">
        {list.map((b) => {
          const isDefault = isDefaultBranch(b.name, defaultBranch);
          const active = value === b.name;
          const chip = (
            <button
              key={b.name}
              type="button"
              className={`krowe-branch-chip${isDefault ? " is-default" : ""}${active ? " active" : ""}`}
              aria-pressed={active}
              title={b.purpose ?? b.name}
              disabled={disabled || busy}
              onClick={() => onChange(b.name, isDefault)}
            >
              <GitBranch className="h-3.5 w-3.5" />
              <span className="krowe-branch-chip-name">{b.name}</span>
              {isDefault && <span className="krowe-branch-chip-tag">pushed</span>}
              {b.local && (
                <span className="krowe-branch-chip-tag is-local">local</span>
              )}
            </button>
          );

          if (!b.local || !onRemoveBranch) return chip;
          return (
            <span key={b.name} className="krowe-branch-chip-pair">
              {chip}
              <button
                type="button"
                className="krowe-branch-chip-remove"
                aria-label={`Remove branch ${b.name}`}
                title={`Remove ${b.name}`}
                disabled={disabled || busy}
                onClick={() => removeBranch(b.name)}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          );
        })}

        <button
          type="button"
          className={`krowe-branch-chip is-none${value === null ? " active" : ""}`}
          aria-pressed={value === null}
          disabled={disabled || busy}
          onClick={() => onChange(null, false)}
        >
          No branch
        </button>

        {onAddBranch &&
          (adding ? (
            <span className="krowe-branch-add">
              <input
                className="krowe-branch-add-input"
                value={draft}
                autoFocus
                spellCheck={false}
                maxLength={MAX_BRANCH_NAME_LENGTH}
                placeholder="feature/checkout-fix"
                aria-label="New branch name"
                aria-invalid={addError ? true : undefined}
                disabled={busy}
                onChange={(e) => {
                  setDraft(e.target.value);
                  if (addError) setAddError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submitAdd();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    closeAdd();
                  }
                }}
              />
              <button
                type="button"
                className="krowe-branch-add-save"
                disabled={busy}
                onClick={() => void submitAdd()}
              >
                {busy ? "Adding…" : "Add"}
              </button>
              <button
                type="button"
                className="krowe-branch-cancel"
                disabled={busy}
                onClick={closeAdd}
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="krowe-branch-chip is-add"
              title="Name a branch GitHub hasn't seen yet"
              disabled={disabled || busy}
              onClick={() => setAdding(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              Add branch
            </button>
          ))}

        {onRefresh && (
          <button
            type="button"
            className="krowe-branch-refresh"
            aria-label="Refresh branches from GitHub"
            title="Refresh branches from GitHub"
            disabled={disabled || refreshing || busy}
            onClick={onRefresh}
          >
            <RotateCw
              className={`h-3.5 w-3.5${refreshing ? " krowe-spin" : ""}`}
            />
          </button>
        )}
      </div>
      {addError ? (
        <p className="krowe-branch-chips-error" role="alert">
          {addError}
        </p>
      ) : (
        <p className="krowe-branch-chips-hint">
          {selected?.purpose ? (
            <>
              <span className="krowe-branch-chips-purpose">{selected.purpose}</span>
              {" · "}
            </>
          ) : null}
          {hint}
        </p>
      )}
    </div>
  );
}
