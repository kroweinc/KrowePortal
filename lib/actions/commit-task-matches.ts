"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { getEngagementRepoById, type EngagementRepo } from "@/lib/github/engagement-repo";
import { getRecentCommitsForBranches } from "@/lib/github/recent-commits";
import { getMainMergeHeads } from "@/lib/github/merged-prs";
import { pickIntegrationBranches } from "@/lib/github/merge-subject";
import {
  matchCommitsToTasks,
  type CommitMatchCandidate,
  type TaskMatchInput,
} from "@/lib/ai/match-commits-to-tasks";
import { writeAuditEntry } from "@/lib/actions/audit-log";
import { isTaskMember } from "@/lib/actions/task-access";
import { markTaskDone } from "@/lib/actions/tasks";
import { linkTaskCommit } from "@/lib/actions/task-commits";
import type { TaskType } from "@/lib/types";

/**
 * The safeguard for work that shipped but was never marked done.
 *
 * Builders finish something and leave the task sitting in In Progress. On board
 * load we scan recent commits, ask the model whether any of them plainly finish
 * an open task, and record high-confidence hits. The board strikes those tasks
 * through and asks the builder to confirm — nothing here ever marks a task done
 * on its own.
 *
 * Scans the default branch *and* the branches recently merged into it, because
 * under a feature → dev → main flow the work is finished on `dev` and only
 * reaches main on the next release. Waiting for that is waiting weeks, by which
 * point the builder has noticed themselves and the safeguard is useless. Which
 * branch a commit was found on decides what confirming may do: only a
 * default-branch commit is provably live, so only that one ships the task.
 */

const pollSchema = z.array(z.string().uuid()).max(50);

/** How many integration branches to scan beside the default one. Each costs a
 *  cached GitHub request; the branches come from recent merges into main, so in
 *  practice this is `dev` plus whatever hotfix branch went out last. */
const MAX_INTEGRATION_BRANCHES = 3;

type OpenTaskRow = {
  id: string;
  title: string;
  description: string | null;
  type: TaskType | null;
  tags: string[] | null;
  created_at: string;
};

/** One scan unit: a repo plus every engagement whose tasks it should be matched against. */
type RepoGroup = { repo: EngagementRepo; engagementIds: string[] };

/**
 * Group engagements by the repo they resolve to.
 *
 * This matters more than it looks: commit_task_matches is keyed by
 * (repo_full_name, commit_sha), so a repo shared by two engagements would
 * otherwise be memoized by whichever scanned first and never scanned for the
 * other's tasks. Engagements with no repo of their own fall back to the user's
 * selected repo, which makes sharing common rather than exotic.
 */
async function groupEngagementsByRepo(
  engagementIds: string[],
  profileId: string
): Promise<RepoGroup[]> {
  const groups = new Map<string, RepoGroup>();
  for (const engagementId of engagementIds) {
    // Membership gate — returns null for anyone who isn't on the engagement.
    const repo = await getEngagementRepoById(engagementId, profileId);
    if (!repo) continue;
    const existing = groups.get(repo.fullName);
    if (existing) existing.engagementIds.push(engagementId);
    else groups.set(repo.fullName, { repo, engagementIds: [engagementId] });
  }
  return [...groups.values()];
}

/**
 * Scan new default-branch commits for work that finishes an open task. Runs on
 * Build Board mount. Returns the task ids that just gained a suggestion so the
 * client only refreshes when there is something new to paint.
 *
 * Costs nothing in the steady state: commits already in commit_task_matches are
 * filtered out before the model is called, so an unchanged repo means one cached
 * GitHub request and zero AI calls.
 */
export async function pollCommitTaskMatches(
  engagementIds: string[]
): Promise<{ taskIds: string[] }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = pollSchema.safeParse(engagementIds);
  if (!parsed.success || parsed.data.length === 0) return { taskIds: [] };

  const admin = createAdminClient();
  const groups = await groupEngagementsByRepo(parsed.data, profile.id);
  const matchedTaskIds: string[] = [];

  for (const { repo, engagementIds: ids } of groups) {
    const { data: openTasks } = await admin
      .from("tasks")
      .select("id, title, description, type, tags, created_at")
      .in("engagement_id", ids)
      .neq("status", "done");

    const candidates: TaskMatchInput[] = ((openTasks ?? []) as OpenTaskRow[]).map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      type: t.type,
      tags: t.tags ?? [],
      createdAt: t.created_at,
    }));
    if (candidates.length === 0) continue;

    // Find the integration branches two ways, because neither alone is reliable:
    // merge commits already on the default branch name their target ("Merge
    // branch 'X' into dev"), which works for a repo that never opens PRs, and
    // merged-PR heads cover a repo that always does. Both read from listings we
    // already fetch and cache.
    const defaultCommits = await getRecentCommitsForBranches(repo, [
      repo.defaultBranch,
    ]);
    const [fromMerges, fromPrs] = [
      pickIntegrationBranches(
        defaultCommits.map((c) => c.message),
        repo.defaultBranch,
        MAX_INTEGRATION_BRANCHES
      ),
      await getMainMergeHeads(repo, MAX_INTEGRATION_BRANCHES),
    ];
    const integration = [...new Set([...fromMerges, ...fromPrs])]
      .filter((b) => b !== repo.defaultBranch)
      .slice(0, MAX_INTEGRATION_BRANCHES);

    // Default branch first so anything already on main keeps the `main` label —
    // getRecentCommitsForBranches dedupes by sha and first branch listed wins.
    const commits = await getRecentCommitsForBranches(repo, [
      repo.defaultBranch,
      ...integration,
    ]);
    if (commits.length === 0) continue;

    const { data: seen } = await admin
      .from("commit_task_matches")
      .select("commit_sha")
      .eq("repo_full_name", repo.fullName)
      .in(
        "commit_sha",
        commits.map((c) => c.sha)
      );

    const seenShas = new Set((seen ?? []).map((r) => r.commit_sha as string));
    const fresh = commits.filter((c) => !seenShas.has(c.sha));
    if (fresh.length === 0) continue;

    const inputs: CommitMatchCandidate[] = fresh.map((c) => ({
      sha: c.sha,
      message: c.message,
      committedAt: c.committedAt,
    }));

    const { matches, model } = await matchCommitsToTasks(
      {
        repoFullName: repo.fullName,
        branch: repo.defaultBranch,
        commits: inputs,
        tasks: candidates,
      },
      { userId: profile.id, operation: "match_commits_to_tasks", engagementId: ids[0] }
    );

    const bySha = new Map(matches.map((m) => [m.sha, m]));
    const now = new Date().toISOString();

    // Every fresh commit gets a row, matched or not. The unmatched rows are the
    // memo that keeps this scan free on the next board load.
    const rows = fresh.map((c) => {
      const match = bySha.get(c.sha);
      return {
        repo_full_name: repo.fullName,
        commit_sha: c.sha,
        task_id: match?.taskId ?? null,
        confidence: match?.confidence ?? null,
        reason: match?.reason ?? null,
        commit_url: c.url,
        commit_message: c.message,
        commit_author_name: c.authorName,
        commit_author_login: c.authorLogin,
        commit_committed_at: c.committedAt,
        branch_name: c.branch,
        state: "pending",
        model,
        generated_at: now,
      };
    });

    const { error } = await admin
      .from("commit_task_matches")
      .upsert(rows, { onConflict: "repo_full_name,commit_sha" });

    if (error) {
      console.error("[pollCommitTaskMatches] write failed", {
        repo: repo.fullName,
        error: error.message,
      });
      continue;
    }

    matchedTaskIds.push(...matches.map((m) => m.taskId));
  }

  if (matchedTaskIds.length > 0) revalidatePath("/b");
  return { taskIds: [...new Set(matchedTaskIds)] };
}

const taskIdSchema = z.string().uuid();

type PendingRow = {
  commit_sha: string;
  commit_url: string | null;
  commit_message: string | null;
  commit_author_name: string | null;
  commit_author_login: string | null;
  commit_committed_at: string | null;
  branch_name: string | null;
  repo_full_name: string;
  confidence: number | null;
};

/**
 * Confirm the suggestion: the task really was finished by that commit.
 *
 * Goes straight to Done and skips the approval flow — markTaskDone resolves any
 * approval that was still open, so a task sitting in the operator's review queue
 * drops out of it rather than stranding there.
 *
 * Whether it also ships depends on where the commit was found. A default-branch
 * commit is provably live, so it names the push and the task goes straight to
 * Shipped. A commit found only on an integration branch is finished but *not*
 * live, so the task lands in Next push tagged with that branch, and the ordinary
 * merge poll ships it when the branch actually reaches main. Claiming otherwise
 * would put a sha that isn't on main into the release ledger.
 */
export async function confirmMatchedTaskDone(
  taskId: string
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = taskIdSchema.safeParse(taskId);
  if (!parsed.success) return { error: "Invalid task" };
  if (!(await isTaskMember(taskId, profile.id)))
    return { error: "You don't have access to this task." };

  const admin = createAdminClient();
  const { data } = await admin
    .from("commit_task_matches")
    .select(
      "commit_sha, commit_url, commit_message, commit_author_name, commit_author_login, commit_committed_at, branch_name, repo_full_name, confidence"
    )
    .eq("task_id", taskId)
    .eq("state", "pending")
    .order("confidence", { ascending: false })
    .limit(1)
    .maybeSingle();

  const match = data as PendingRow | null;
  if (!match) return { error: "That suggestion is no longer available." };

  // Only the scan knows which branch it read the commit off, and only a
  // default-branch commit may ship. Re-resolve the repo to learn what "default"
  // is; if it can't be resolved, fail closed and treat the work as not yet live.
  const { data: taskRow } = await admin
    .from("tasks")
    .select("engagement_id")
    .eq("id", taskId)
    .single();
  const engagementId = (taskRow?.engagement_id as string | null) ?? null;
  const repo = engagementId
    ? await getEngagementRepoById(engagementId, profile.id)
    : null;
  const isLive =
    repo !== null &&
    match.branch_name !== null &&
    match.branch_name === repo.defaultBranch;

  // The done write gates everything else — if it fails, nothing else should land.
  const done = await markTaskDone(taskId, {
    pushed_to_main: isLive,
    completion_note: null,
    branch_name: match.branch_name,
    // A default-branch commit names the push this went live in, so two tasks
    // confirmed against one commit share a release.
    ship: isLive
      ? {
          repo_full_name: match.repo_full_name,
          merge_sha: match.commit_sha,
          // Names the release after the commit that shipped it, the same way
          // the push poll names one after the tip it detected.
          message: match.commit_message,
        }
      : null,
  });
  if ("error" in done) return done;

  // The commit link IS the deliverable here (task_commits stores its URL), which
  // is why completion_note stays null — DeliveryChips renders a completion_note
  // URL as a "Live" chip, and a commit link is not a live site.
  await Promise.all([
    match.commit_url
      ? linkTaskCommit(taskId, {
          sha: match.commit_sha,
          url: match.commit_url,
          message: match.commit_message,
          author_name: match.commit_author_name,
          author_login: match.commit_author_login,
          committed_at: match.commit_committed_at,
          repo_full_name: match.repo_full_name,
        })
      : Promise.resolve(),
    admin
      .from("commit_task_matches")
      .update({
        state: "confirmed",
        resolved_by: profile.id,
        resolved_at: new Date().toISOString(),
      })
      .eq("task_id", taskId)
      .eq("state", "pending"),
  ]);

  after(() =>
    writeAuditEntry({
      taskId,
      actorId: profile.id,
      action: "task.commit_match_confirmed",
      metadata: {
        sha: match.commit_sha,
        short_sha: match.commit_sha.slice(0, 7),
        repo: match.repo_full_name,
        confidence: match.confidence,
      },
    })
  );

  revalidatePath("/b");
  revalidatePath("/b/staging");
  return { success: true };
}

/**
 * Reject the suggestion: the task isn't finished. The matched commits are marked
 * dismissed so they never resurface — a later commit can still match this task,
 * which is what we want, but the same evidence won't be offered twice.
 */
export async function dismissTaskCommitMatch(
  taskId: string
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = taskIdSchema.safeParse(taskId);
  if (!parsed.success) return { error: "Invalid task" };
  if (!(await isTaskMember(taskId, profile.id)))
    return { error: "You don't have access to this task." };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("commit_task_matches")
    .update({
      state: "dismissed",
      resolved_by: profile.id,
      resolved_at: new Date().toISOString(),
    })
    .eq("task_id", taskId)
    .eq("state", "pending")
    .select("commit_sha");

  if (error) return { error: error.message };

  const shas = (data ?? []).map((r) => r.commit_sha as string);
  if (shas.length > 0) {
    after(() =>
      writeAuditEntry({
        taskId,
        actorId: profile.id,
        action: "task.commit_match_dismissed",
        metadata: { shas, short_shas: shas.map((s) => s.slice(0, 7)) },
      })
    );
  }

  revalidatePath("/b");
  return { success: true };
}
