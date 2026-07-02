import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { TaskPriority, TaskStatus, TaskType } from "@/lib/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export function sortByPriority<T extends { priority: TaskPriority }>(items: T[]): T[] {
  return [...items].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
}

type ApprovalFields = { approval_sent_at: string | null; approval_approved_at: string | null };

/** Sent for approval and not yet signed off — these pin to the top of their
 *  column. Approved-but-not-done tasks unpin: they're ordinary unblocked work
 *  again (the green "Approved" pill still marks them). */
export function isAwaitingApproval(t: ApprovalFields): boolean {
  return !!t.approval_sent_at && !t.approval_approved_at;
}

/** Column ordering shared by the board and the operator list: tasks awaiting
 *  approval first, then priority, then manual sort_order. */
export function sortWithApprovalPin<
  T extends ApprovalFields & { priority: TaskPriority; sort_order?: number | null }
>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const pinDiff = Number(isAwaitingApproval(b)) - Number(isAwaitingApproval(a));
    if (pinDiff !== 0) return pinDiff;
    const rankDiff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (rankDiff !== 0) return rankDiff;
    return (a.sort_order ?? 0) - (b.sort_order ?? 0);
  });
}

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  urgent: "Urgent",
  low: "Low",
  medium: "Medium",
  high: "High",
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "To-Do",
  in_progress: "In Progress",
  done: "Done",
};

/** The builder's single forward step from a task's current state. Approval is
 *  a gate inside In Progress, not a column: an in-progress task advances to
 *  the approval dialog first, then (once sent) to the done dialog. */
export type TaskAdvance =
  | { kind: "status"; status: TaskStatus; label: string }
  | { kind: "approval"; label: string }
  | { kind: "done"; label: string };

export function getTaskAdvance(t: {
  status: TaskStatus;
  approval_sent_at: string | null;
}): TaskAdvance | null {
  switch (t.status) {
    case "backlog":
      return { kind: "status", status: "todo", label: "To-Do" };
    case "todo":
      return { kind: "status", status: "in_progress", label: "In Progress" };
    case "in_progress":
      return t.approval_sent_at
        ? { kind: "done", label: "Done" }
        : { kind: "approval", label: "Approval" };
    case "done":
      return null;
  }
}

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  feature: "Feature",
  bug: "Bug",
  change: "Change",
};

// Option list for the InlineSelect type override in the task detail.
export const TASK_TYPE_OPTIONS: { value: TaskType; label: string }[] = [
  { value: "feature", label: "Feature" },
  { value: "bug", label: "Bug" },
  { value: "change", label: "Change" },
];

/** Display name of whoever submitted a task (joined as `creator`). Falls back to
 *  a capitalized role, then "Unknown" — used in place of the old source badge. */
export function submitterName(
  creator?: { display_name: string | null; role: "operator" | "builder" } | null
): string {
  const name = creator?.display_name?.trim();
  if (name) return name;
  if (creator?.role) return creator.role.charAt(0).toUpperCase() + creator.role.slice(1);
  return "Unknown";
}

/** Initials for the avatar fallback: first letters of up to two name words. */
export function submitterInitials(
  creator?: { display_name: string | null; role: "operator" | "builder" } | null
): string {
  const parts = submitterName(creator).split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join("") || "•";
}
