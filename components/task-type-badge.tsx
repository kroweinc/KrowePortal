import { Sparkles, Bug, GitPullRequestArrow, type LucideIcon } from "lucide-react";
import type { TaskType } from "@/lib/types";
import { TASK_TYPE_LABELS } from "@/lib/utils";

// Linear-style change-type icons. Presentational only (no "use client") so this
// renders in both the server detail pages and the client board/list components.
const TYPE_ICON: Record<TaskType, LucideIcon> = {
  feature: Sparkles,
  bug: Bug,
  change: GitPullRequestArrow,
};

export function TaskTypeBadge({ type }: { type: TaskType | null }) {
  if (!type) return null;
  const Icon = TYPE_ICON[type];
  return (
    <span className={`krowe-chip krowe-chip-type ${type}`}>
      <Icon width={11} height={11} strokeWidth={2.25} aria-hidden />
      {TASK_TYPE_LABELS[type]}
    </span>
  );
}

export function TaskTags({ tags }: { tags: string[] }) {
  if (!tags?.length) return null;
  return (
    <>
      {tags.map((tag) => (
        <span key={tag} className="krowe-chip krowe-chip-tag">
          {tag}
        </span>
      ))}
    </>
  );
}
