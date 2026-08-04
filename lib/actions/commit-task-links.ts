import "server-only";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { DEV_PROFILE_IDS } from "@/lib/auth";
import type { Role, TaskType } from "@/lib/types";

/**
 * What the Repo page's Updates rows know about a commit beyond git itself:
 * which task it closed and who filed that task. Absent for commits nobody
 * linked — the row renders without those chips rather than guessing.
 */
export type CommitTaskLink = {
  taskId: string;
  taskType: TaskType | null;
  /** Role of the person who created the task, not the commit author. */
  role: Role | null;
};

type LinkRow = {
  commit_sha: string;
  task: {
    id: string;
    type: TaskType | null;
    creator: { role: Role } | { role: Role }[] | null;
  } | null;
};

/**
 * Map the given shas to their linked task, keyed by full sha.
 *
 * RLS on task_commits already limits rows to tasks the caller can see, so an
 * unlinked commit and a commit linked to someone else's task both read as
 * "no link" — which is the behavior we want either way.
 */
export async function getCommitTaskLinks(
  profileId: string,
  repoFullName: string,
  shas: string[]
): Promise<Map<string, CommitTaskLink>> {
  const out = new Map<string, CommitTaskLink>();
  if (shas.length === 0) return out;

  const supabase = DEV_PROFILE_IDS.has(profileId)
    ? createAdminClient()
    : await createClient();

  const { data, error } = await supabase
    .from("task_commits")
    .select("commit_sha, task:tasks(id, type, creator:profiles!created_by(role))")
    .eq("repo_full_name", repoFullName)
    .in("commit_sha", shas);

  if (error) {
    console.error("[getCommitTaskLinks] read failed", {
      repo: repoFullName,
      error: error.message,
    });
    return out;
  }

  for (const row of (data ?? []) as unknown as LinkRow[]) {
    if (!row.task) continue;
    // PostgREST types an embedded one-to-one as an array in some shapes; take
    // the first either way.
    const creator = Array.isArray(row.task.creator) ? row.task.creator[0] : row.task.creator;
    out.set(row.commit_sha, {
      taskId: row.task.id,
      taskType: row.task.type,
      role: creator?.role ?? null,
    });
  }

  return out;
}
