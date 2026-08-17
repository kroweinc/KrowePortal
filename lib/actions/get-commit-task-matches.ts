import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import type { TaskStatus } from "@/lib/types";

/**
 * An unresolved "this commit looks like it finished this task" suggestion, as
 * the Build Board card renders it. Read server-side only: commit_task_matches
 * has RLS on with no policies (service role only), and every caller here has
 * already scoped the task ids to tasks the viewer can see.
 */
export type PendingCommitMatch = {
  sha: string;
  shortSha: string;
  url: string | null;
  /** First line of the commit message — the card shows one line. */
  subject: string;
  reason: string | null;
  confidence: number | null;
  committedAt: string | null;
  /** The scan was confident enough to mark the task done itself; the card is
   *  reporting a move that already happened, not proposing one. */
  autoApplied: boolean;
  /** Where "Not done" puts the task back. Null on an ordinary suggestion. */
  priorStatus: TaskStatus | null;
};

type MatchRow = {
  task_id: string;
  commit_sha: string;
  commit_url: string | null;
  commit_message: string | null;
  commit_committed_at: string | null;
  reason: string | null;
  confidence: number | null;
  auto_applied_at: string | null;
  prior_status: TaskStatus | null;
};

/**
 * Pending matches for the given tasks, keyed by task id — the strongest one when
 * a task has several. A plain object rather than a Map because it crosses into
 * the client TaskBoard, same as branchesByEngagement / stagingGroupsByEngagement.
 *
 * Takes statuses, not bare ids, because "pending" means two things now. On an
 * open task it's an unanswered suggestion. On a done task it's only meaningful
 * when the scan is what moved it (auto_applied_at) — a task the builder
 * completed by hand must never resurface a suggestion about work they already
 * closed, and nothing resolves those rows on the normal done path.
 */
export async function getPendingCommitMatches(
  tasks: { id: string; status: TaskStatus }[]
): Promise<Record<string, PendingCommitMatch>> {
  const out: Record<string, PendingCommitMatch> = {};
  if (tasks.length === 0) return out;

  const doneIds = new Set(tasks.filter((t) => t.status === "done").map((t) => t.id));

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("commit_task_matches")
    .select(
      "task_id, commit_sha, commit_url, commit_message, commit_committed_at, reason, confidence, auto_applied_at, prior_status"
    )
    .in(
      "task_id",
      tasks.map((t) => t.id)
    )
    .eq("state", "pending")
    .order("confidence", { ascending: false });

  if (error) {
    console.error("[getPendingCommitMatches] read failed", { error: error.message });
    return out;
  }

  for (const row of (data ?? []) as MatchRow[]) {
    // Ordered by confidence desc, so the first row per task is the strongest.
    if (out[row.task_id]) continue;
    if (doneIds.has(row.task_id) && !row.auto_applied_at) continue;
    out[row.task_id] = {
      sha: row.commit_sha,
      shortSha: row.commit_sha.slice(0, 7),
      url: row.commit_url,
      subject: (row.commit_message ?? "").split("\n")[0].trim(),
      reason: row.reason,
      confidence: row.confidence,
      committedAt: row.commit_committed_at,
      autoApplied: !!row.auto_applied_at,
      priorStatus: row.prior_status,
    };
  }

  return out;
}
