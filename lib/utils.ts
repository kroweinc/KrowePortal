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

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  urgent: "Urgent",
  low: "Low",
  medium: "Medium",
  high: "High",
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  inbox: "In Progress",
  in_progress: "In Progress",
  blocked: "Approval",
  done: "Done",
};

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
