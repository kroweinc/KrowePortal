import type { Task } from "@/lib/types";
import { isAwaitingApproval, sortByPriority } from "@/lib/utils";

/** The operator board's tasks, split into the sections it renders. Pure so it's
 *  unit-testable — the component just calls this and maps each bucket to cards.
 *
 *  Pinned tasks are pulled out of review/progress/upNext (no duplication). The
 *  two "Delivered" buckets are mutually exclusive: Staged = finished but not yet
 *  pushed to main; Done this week = pushed and completed within the window. A
 *  done+pushed task older than the window falls out of both (old shipped
 *  history, intentionally out of scope for the operator's at-a-glance view). */
export interface OperatorBuckets {
  /** pinned_at set and not done — newest pin first. Rendered at the very top. */
  pinned: Task[];
  /** Sent for approval, not yet signed off — newest submission first. */
  review: Task[];
  /** In progress (and not awaiting approval), by priority. */
  progress: Task[];
  /** Backlog / to-do (and not awaiting approval), by priority. */
  upNext: Task[];
  /** Done but not yet pushed to main — queued to go live, newest first. */
  staged: Task[];
  /** Done, pushed to main, completed within the window — newest first. */
  doneThisWeek: Task[];
}

/** Completion time, falling back to updated_at — completed_at is null for tasks
 *  finished before migration 0011. */
function completedMs(t: Task): number {
  return +new Date(t.completed_at ?? t.updated_at);
}

export function computeOperatorBuckets(tasks: Task[], weekAgoMs: number): OperatorBuckets {
  const isPinned = (t: Task) => !!t.pinned_at && t.status !== "done";

  const pinned = tasks
    .filter(isPinned)
    .sort((a, b) => +new Date(b.pinned_at ?? 0) - +new Date(a.pinned_at ?? 0));

  const review = tasks
    .filter((t) => !isPinned(t) && isAwaitingApproval(t))
    .sort((a, b) => +new Date(b.approval_sent_at ?? 0) - +new Date(a.approval_sent_at ?? 0));

  const progress = sortByPriority(
    tasks.filter((t) => !isPinned(t) && t.status === "in_progress" && !isAwaitingApproval(t))
  );

  const upNext = sortByPriority(
    tasks.filter(
      (t) =>
        !isPinned(t) &&
        (t.status === "backlog" || t.status === "todo") &&
        !isAwaitingApproval(t)
    )
  );

  const byCompletedDesc = (a: Task, b: Task) => completedMs(b) - completedMs(a);

  const staged = tasks
    .filter((t) => t.status === "done" && !t.pushed_to_main)
    .sort(byCompletedDesc);

  const doneThisWeek = tasks
    .filter((t) => t.status === "done" && t.pushed_to_main && completedMs(t) >= weekAgoMs)
    .sort(byCompletedDesc);

  return { pinned, review, progress, upNext, staged, doneThisWeek };
}
