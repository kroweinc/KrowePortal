import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { TaskChangeRequest, TaskPriority, TaskStatus, TaskType } from "@/lib/types";

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

/** The operator's most recent send-back, while it's still actionable. Requesting
 *  changes clears approval_sent_at, so the note stays visible exactly until the
 *  builder re-submits for approval (or the task is approved/done). Null when the
 *  query didn't embed change_requests. */
export function getActiveChangeRequest(
  t: ApprovalFields & { status: TaskStatus; change_requests?: TaskChangeRequest[] }
): TaskChangeRequest | null {
  const entry = t.change_requests?.[0];
  if (!entry) return null;
  if (t.approval_sent_at || t.approval_approved_at || t.status === "done") return null;
  return entry;
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

/** Board sort options surfaced in the sort dropdown. "default" keeps the
 *  approval-pin + priority + manual-order rule above; the rest are pure sorts. */
export type TaskSortKey = "default" | "updated" | "completed" | "name" | "created";

export const TASK_SORT_OPTIONS: { value: TaskSortKey; label: string }[] = [
  { value: "default", label: "Priority" },
  { value: "updated", label: "Recently updated" },
  { value: "completed", label: "Recently completed" },
  { value: "name", label: "Name (A–Z)" },
  { value: "created", label: "Newest created" },
];

type SortableTask = ApprovalFields & {
  priority: TaskPriority;
  sort_order?: number | null;
  title: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

/** Board display ordering. "default" delegates to the pinned priority sort;
 *  the explicit keys are pure and intentionally ignore the approval pin. */
export function sortTasksByKey<T extends SortableTask>(items: T[], key: TaskSortKey): T[] {
  if (key === "default") return sortWithApprovalPin(items);
  const desc = (a?: string | null, b?: string | null) =>
    new Date(b ?? 0).getTime() - new Date(a ?? 0).getTime();
  return [...items].sort((a, b) => {
    switch (key) {
      case "updated":
        return desc(a.updated_at, b.updated_at);
      case "completed":
        return desc(a.completed_at, b.completed_at);
      case "created":
        return desc(a.created_at, b.created_at);
      case "name":
        return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
      default:
        return 0;
    }
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

/** Compact relative timestamp for card metadata ("just now", "3h ago",
 *  "yesterday"), falling back to a short date past two weeks. */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 14) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Initials for the avatar fallback: first letters of up to two name words. */
export function submitterInitials(
  creator?: { display_name: string | null; role: "operator" | "builder" } | null
): string {
  const parts = submitterName(creator).split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join("") || "•";
}
