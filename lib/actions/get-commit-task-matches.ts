import "server-only";

import { createAdminClient } from "@/lib/supabase/server";

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
};

type MatchRow = {
  task_id: string;
  commit_sha: string;
  commit_url: string | null;
  commit_message: string | null;
  commit_committed_at: string | null;
  reason: string | null;
  confidence: number | null;
};

/**
 * Pending matches for the given tasks, keyed by task id — the strongest one when
 * a task has several. A plain object rather than a Map because it crosses into
 * the client TaskBoard, same as branchesByEngagement / stagingGroupsByEngagement.
 *
 * Callers pass only tasks that are still open — a done task never renders a
 * suggestion, which is why nothing has to resolve these rows when a task is
 * completed by the normal flow.
 */
export async function getPendingCommitMatches(
  taskIds: string[]
): Promise<Record<string, PendingCommitMatch>> {
  const out: Record<string, PendingCommitMatch> = {};
  if (taskIds.length === 0) return out;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("commit_task_matches")
    .select(
      "task_id, commit_sha, commit_url, commit_message, commit_committed_at, reason, confidence"
    )
    .in("task_id", taskIds)
    .eq("state", "pending")
    .order("confidence", { ascending: false });

  if (error) {
    console.error("[getPendingCommitMatches] read failed", { error: error.message });
    return out;
  }

  for (const row of (data ?? []) as MatchRow[]) {
    // Ordered by confidence desc, so the first row per task is the strongest.
    if (out[row.task_id]) continue;
    out[row.task_id] = {
      sha: row.commit_sha,
      shortSha: row.commit_sha.slice(0, 7),
      url: row.commit_url,
      subject: (row.commit_message ?? "").split("\n")[0].trim(),
      reason: row.reason,
      confidence: row.confidence,
      committedAt: row.commit_committed_at,
    };
  }

  return out;
}
