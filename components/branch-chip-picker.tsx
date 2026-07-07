"use client";

import { GitBranch, RotateCw } from "lucide-react";
import type { EngagementBranch } from "@/lib/actions/get-engagement-branches";
import { isDefaultBranch } from "@/lib/tasks/staging-grouping";

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
}

/**
 * One-click branch chips that replace the old branch dropdown + "Pushed to
 * main" checkbox. The default branch is the front chip and, when picked, marks
 * the task pushed to main (green, "shipped"); any other branch is staged for
 * the next push (amber); "No branch" opts out of branch grouping.
 */
export function BranchChipPicker({
  branches,
  defaultBranch,
  value,
  onChange,
  disabled,
  onRefresh,
  refreshing,
}: BranchChipPickerProps) {
  // Guarantee the default branch is always an option even if the graph didn't
  // surface it, so "main" is always one click away.
  const names = branches.map((b) => b.name);
  const list: EngagementBranch[] =
    defaultBranch && !names.includes(defaultBranch)
      ? [{ name: defaultBranch, purpose: null }, ...branches]
      : branches;

  const selectedPurpose =
    value !== null ? branches.find((b) => b.name === value)?.purpose ?? null : null;
  const hint =
    value === null
      ? "No branch — won't show under a branch group."
      : value === defaultBranch
        ? "On the default branch — marks this as pushed to main."
        : "Staged for the next push.";

  return (
    <div className="krowe-branch-chips-wrap">
      <div className="krowe-branch-chips" role="group" aria-label="Branch">
        {list.map((b) => {
          const isDefault = isDefaultBranch(b.name, defaultBranch);
          const active = value === b.name;
          return (
            <button
              key={b.name}
              type="button"
              className={`krowe-branch-chip${isDefault ? " is-default" : ""}${active ? " active" : ""}`}
              aria-pressed={active}
              title={b.purpose ?? b.name}
              disabled={disabled}
              onClick={() => onChange(b.name, isDefault)}
            >
              <GitBranch className="h-3.5 w-3.5" />
              <span className="krowe-branch-chip-name">{b.name}</span>
              {isDefault && <span className="krowe-branch-chip-tag">pushed</span>}
            </button>
          );
        })}

        <button
          type="button"
          className={`krowe-branch-chip is-none${value === null ? " active" : ""}`}
          aria-pressed={value === null}
          disabled={disabled}
          onClick={() => onChange(null, false)}
        >
          No branch
        </button>

        {onRefresh && (
          <button
            type="button"
            className="krowe-branch-refresh"
            aria-label="Refresh branches from GitHub"
            title="Refresh branches from GitHub"
            disabled={disabled || refreshing}
            onClick={onRefresh}
          >
            <RotateCw
              className={`h-3.5 w-3.5${refreshing ? " krowe-spin" : ""}`}
            />
          </button>
        )}
      </div>
      <p className="krowe-branch-chips-hint">
        {selectedPurpose ? (
          <>
            <span className="krowe-branch-chips-purpose">{selectedPurpose}</span>
            {" · "}
          </>
        ) : null}
        {hint}
      </p>
    </div>
  );
}
