import {
  Sparkles,
  Bug,
  GitPullRequestArrow,
  Code2,
  MessageCircleQuestion,
  Mail,
  MoreHorizontal,
  type LucideIcon,
} from "lucide-react";
import type { TaskType, WorkKind } from "@/lib/types";
import { TASK_TYPE_LABELS, WORK_KIND_LABELS } from "@/lib/utils";

// Linear-style change-type icons. Presentational only (no "use client") so this
// renders in both the server detail pages and the client board/list components.
export const TASK_TYPE_ICONS: Record<TaskType, LucideIcon> = {
  feature: Sparkles,
  bug: Bug,
  change: GitPullRequestArrow,
};

export function TaskTypeBadge({ type }: { type: TaskType | null }) {
  if (!type) return null;
  const Icon = TASK_TYPE_ICONS[type];
  return (
    <span className={`krowe-chip krowe-chip-type ${type}`}>
      <Icon width={11} height={11} strokeWidth={2.25} aria-hidden />
      {TASK_TYPE_LABELS[type]}
    </span>
  );
}

// What the task IS, as opposed to what kind of change it makes (migration
// 0089). Set when the task is sent for approval; null on anything never asked.
export const WORK_KIND_ICONS: Record<WorkKind, LucideIcon> = {
  code: Code2,
  question: MessageCircleQuestion,
  email: Mail,
  other: MoreHorizontal,
};

/** Renders nothing for null — a task that predates the question shouldn't wear
 *  a "Code" label nobody chose for it. */
export function WorkKindBadge({ kind }: { kind: WorkKind | null }) {
  if (!kind) return null;
  const Icon = WORK_KIND_ICONS[kind];
  return (
    <span className="krowe-chip krowe-chip-work">
      <Icon width={11} height={11} strokeWidth={2.25} aria-hidden />
      {WORK_KIND_LABELS[kind]}
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
