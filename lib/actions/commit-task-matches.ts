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
import {
  shouldAutoApply,
  AUTO_APPLY_CONFIDENCE_THRESHOLD,
} from "@/lib/tasks/commit-match-filter";
import { writeAuditEntry } from "@/lib/actions/audit-log";
import { isTaskMember } from "@/lib/actions/task-access";
import { markTaskDone } from "@/lib/actions/tasks";
import { linkTaskCommit } from "@/lib/actions/task-commits";
import { notifyTaskEvent } from "@/lib/email/task-notify";
import type { TaskStatus, TaskType } from "@/lib/types";

/**
 * The safeguard for work that shipped but was never marked done.
 *
 * Builders finish something and leave the task sitting in In Progress. On board
 * load we scan recent commits, ask the model whether any of them plainly finish
 * an open task, and record high-confidence hits.
 *
 * What happens next splits on confidence. Between the two thresholds the board
 * paints a card and waits for the builder to confirm. At or above the auto
 * threshold (shouldAutoApply) the scan moves the task to Done itself and shows
 * the builder what it did: the row stays `pending`, so the card is still there,
 * but now it says "marked done automatically" and Not done reverses the whole
 * move — status, ship, release, approval, commit link. The operator's
 * "delivered" email is held back until the builder presses Keep, because a
 * rejection has to be able to leave no trace outside the app.
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

/** Everything the apply and reverse paths read off a match row. */
const MATCH_COLUMNS =
  "commit_sha, commit_url, commit_message, commit_author_name, commit_author_login, " +
  "commit_committed_at, branch_name, repo_full_name, confidence, auto_applied_at, " +
  "prior_status, cleared_approval";

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
  /** Set when the scan marked the task done itself — see the module comment. */
  auto_applied_at: string | null;
  prior_status: TaskStatus | null;
  cleared_approval: boolean;
};

/**
 * Mark the task done off the strength of a commit, and link the commit to it.
 * Shared by the builder pressing Confirm and by the auto-move, because they are
 * the same write — they differ only in whether the operator hears about it.
 *
 * Whether it also ships depends on where the commit was found. A default-branch
 * commit is provably live, so it names the push and the task goes straight to
 * Shipped. A commit found only on an integration branch is finished but *not*
 * live, so the task lands in Next push tagged with that branch, and the ordinary
 * merge poll ships it when the branch actually reaches main. Claiming otherwise
 * would put a sha that isn't on main into the release ledger. Fails closed if
 * the repo can't be resolved.
 */
async function applyMatchToTask(
  taskId: string,
  match: PendingRow,
  profileId: string,
  opts: { notify: boolean }
): Promise<{ success: true } | { error: string }> {
  const admin = createAdminClient();

  // Only the scan knows which branch it read the commit off, and only a
  // default-branch commit may ship. Re-resolve the repo to learn what "default"
  // is; if it can't be resolved, fail closed and treat the work as not yet live.
  const { data: taskRow } = await admin
    .from("tasks")
    .select("engagement_id")
    .eq("id", taskId)
    .single();
  const engagementId = (taskRow?.engagement_id as string | null) ?? null;
  const repo = engagementId ? await getEngagementRepoById(engagementId, profileId) : null;
  const isLive =
    repo !== null && match.branch_name !== null && match.branch_name === repo.defaultBranch;

  // The done write gates everything else — if it fails, nothing else should land.
  const done = await markTaskDone(taskId, {
    pushed_to_main: isLive,
    completion_note: null,
    branch_name: match.branch_name,
    notify: opts.notify,
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
  if (match.commit_url) {
    await linkTaskCommit(taskId, {
      sha: match.commit_sha,
      url: match.commit_url,
      message: match.commit_message,
      author_name: match.commit_author_name,
      author_login: match.commit_author_login,
      committed_at: match.commit_committed_at,
      repo_full_name: match.repo_full_name,
    });
  }

  return { success: true };
}

/**
 * Move the near-certain matches to Done without asking, recording enough to put
 * every one of them back exactly as it was.
 *
 * Reads the table rather than taking the matches the scan just produced, so it
 * covers the case that would otherwise never resolve: a match recorded on an
 * earlier load. Commits already in commit_task_matches are filtered out before
 * the model runs, so on a repo whose work was all scanned before this feature
 * existed there are no fresh commits to hang an apply on and those rows would
 * sit pending forever. Scoped to the open tasks the caller already read, which
 * is also the membership gate — a repo shared by several engagements only ever
 * applies to the tasks of the one being polled.
 *
 * The snapshot is written BEFORE the task is touched, because marking done is a
 * lossy write: status, completed_at and an operator's open approval all collapse
 * into one row and there is no reading them back afterwards. If the apply then
 * fails, the snapshot is cleared again — an auto_applied_at over an unmoved task
 * would have the card claim a move that never happened, and Not done restore a
 * status the task never left.
 */
async function sweepAutoApplies(
  admin: ReturnType<typeof createAdminClient>,
  repoFullName: string,
  profileId: string,
  openTasks: TaskMatchInput[]
): Promise<string[]> {
  if (openTasks.length === 0) return [];

  const { data } = await admin
    .from("commit_task_matches")
    .select(`task_id, ${MATCH_COLUMNS}`)
    .eq("repo_full_name", repoFullName)
    .eq("state", "pending")
    .is("auto_applied_at", null)
    .gte("confidence", AUTO_APPLY_CONFIDENCE_THRESHOLD)
    .in(
      "task_id",
      openTasks.map((t) => t.id)
    );

  const rows = (data ?? []) as unknown as (PendingRow & { task_id: string })[];
  const applied: string[] = [];

  for (const row of rows) {
    // Belt and braces: the query filters on the threshold, but the predicate is
    // the one definition of "certain enough" and it should be the one that runs.
    if (!shouldAutoApply({ confidence: row.confidence ?? 0 })) continue;

    const { data: before } = await admin
      .from("tasks")
      .select("status, approval_sent_at, approval_approved_at")
      .eq("id", row.task_id)
      .single();
    // Done by hand between the scan and here — nothing to move, and no snapshot
    // worth taking.
    if (!before || before.status === "done") continue;

    const priorStatus = before.status as TaskStatus;
    // markTaskDone stamps approval_approved_at on a task still awaiting sign-off
    // (0073). Record that we were the one to stamp it, or the reversal can't tell
    // it apart from an approval the operator had already given.
    const clearedApproval = !!before.approval_sent_at && !before.approval_approved_at;

    const { error: snapError } = await admin
      .from("commit_task_matches")
      .update({
        auto_applied_at: new Date().toISOString(),
        prior_status: priorStatus,
        cleared_approval: clearedApproval,
      })
      .eq("repo_full_name", repoFullName)
      .eq("commit_sha", row.commit_sha)
      .eq("state", "pending");
    if (snapError) {
      console.error("[sweepAutoApplies] snapshot failed", {
        sha: row.commit_sha,
        error: snapError.message,
      });
      continue;
    }

    const result = await applyMatchToTask(row.task_id, row, profileId, { notify: false });
    if ("error" in result) {
      await admin
        .from("commit_task_matches")
        .update({ auto_applied_at: null, prior_status: null, cleared_approval: false })
        .eq("repo_full_name", repoFullName)
        .eq("commit_sha", row.commit_sha);
      console.error("[sweepAutoApplies] apply failed", {
        sha: row.commit_sha,
        error: result.error,
      });
      continue;
    }

    await writeAuditEntry({
      taskId: row.task_id,
      actorId: profileId,
      action: "task.commit_match_auto_applied",
      metadata: {
        sha: row.commit_sha,
        short_sha: row.commit_sha.slice(0, 7),
        repo: repoFullName,
        confidence: row.confidence,
        prior_status: priorStatus,
      },
    });
    applied.push(row.task_id);
  }

  return applied;
}

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
    if (commits.length === 0) {
      await sweepAutoApplies(admin, repo.fullName, profile.id, candidates);
      continue;
    }

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
    if (fresh.length === 0) {
      await sweepAutoApplies(admin, repo.fullName, profile.id, candidates);
      continue;
    }

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

    // The near-certain ones move themselves. Driven off the table rather than
    // the rows just written, so one path covers both a match found this second
    // and one recorded before auto-apply existed (or on a load where every
    // commit was already scanned, which is the steady state).
    await sweepAutoApplies(admin, repo.fullName, profile.id, candidates);

    matchedTaskIds.push(...matches.map((m) => m.taskId));
  }

  if (matchedTaskIds.length > 0) revalidatePath("/b");
  return { taskIds: [...new Set(matchedTaskIds)] };
}

const taskIdSchema = z.string().uuid();

/** The strongest unresolved match on a task, however it got there. */
async function loadPendingMatch(
  admin: ReturnType<typeof createAdminClient>,
  taskId: string
): Promise<PendingRow | null> {
  const { data } = await admin
    .from("commit_task_matches")
    .select(MATCH_COLUMNS)
    .eq("task_id", taskId)
    .eq("state", "pending")
    .order("confidence", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as PendingRow | null) ?? null;
}

/**
 * Confirm the match: the task really was finished by that commit.
 *
 * Two shapes, one outcome. On an ordinary suggestion this is the write — it
 * marks the task done, skipping the approval flow, because markTaskDone resolves
 * any approval that was still open and a task sitting in the operator's review
 * queue should drop out of it rather than stranding there. On an auto-applied
 * match the task moved at scan time, so all that's left is to stand behind it:
 * the row resolves and the operator's "delivered" mail, held back since the
 * move, finally goes out.
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
  const match = await loadPendingMatch(admin, taskId);
  if (!match) return { error: "That suggestion is no longer available." };

  // An auto-applied task is already done and already linked to its commit —
  // re-running the apply would re-stamp completed_at and re-date the work.
  if (!match.auto_applied_at) {
    const applied = await applyMatchToTask(taskId, match, profile.id, { notify: true });
    if ("error" in applied) return applied;
  }

  await admin
    .from("commit_task_matches")
    .update({
      state: "confirmed",
      resolved_by: profile.id,
      resolved_at: new Date().toISOString(),
    })
    .eq("task_id", taskId)
    .eq("state", "pending");

  // The mail the auto-move withheld. Deferred like every other notify in this
  // codebase, and sent only here, so the one thing a rejected auto-move can
  // never do is tell the operator work was delivered.
  if (match.auto_applied_at) {
    after(() =>
      notifyTaskEvent({ taskId, actor: profile, event: "delivered", note: null })
    );
  }

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
 * Put an auto-applied task back exactly as it was.
 *
 * Writes the columns setTasksPushedToMain's Undo writes (lib/actions/tasks.ts)
 * rather than calling it: that path gates on `status === 'done'` and runs its own
 * engagement checks, while the status has to move in the same write as the
 * un-ship — a task left `done` with no release for even one render reads as
 * finished work nobody shipped.
 *
 * The emptied release is deliberately left standing. An emptied `kind='auto'`
 * release is the idempotency tombstone that stops the push poll re-shipping this
 * work, which is the same reason gcEmptyManualReleases only ever sweeps manual
 * rows.
 */
async function reverseAutoApply(
  admin: ReturnType<typeof createAdminClient>,
  taskId: string,
  match: PendingRow
): Promise<{ error: string } | null> {
  // The snapshot is the only record of where this came from; the constraint in
  // 0087 makes a null here impossible, so treat it as one.
  if (!match.prior_status) return { error: "That auto-completion can't be undone." };

  const updates: Record<string, unknown> = {
    status: match.prior_status,
    completed_at: null,
    completion_note: null,
    pushed_to_main: false,
    release_id: null,
    shipped_at: null,
    updated_at: new Date().toISOString(),
  };
  // Only un-stamp an approval the auto-move itself resolved — an operator's real
  // sign-off predates the move and has to survive it.
  if (match.cleared_approval) updates.approval_approved_at = null;

  const { error } = await admin.from("tasks").update(updates).eq("id", taskId);
  if (error) return { error: error.message };

  // The commit link was the auto-move's claim about what shipped; it goes with
  // it. Deleted by (task, sha) rather than through unlinkTaskCommit, which is
  // keyed by the task_commits row id we'd have to look up first.
  await admin
    .from("task_commits")
    .delete()
    .eq("task_id", taskId)
    .eq("commit_sha", match.commit_sha);

  return null;
}

/**
 * Reject the match: the task isn't finished. The matched commits are marked
 * dismissed so they never resurface — a later commit can still match this task,
 * which is what we want, but the same evidence won't be offered twice.
 *
 * When the scan had already moved the task, this is also the undo: it goes back
 * to the status it held before, un-shipped and unlinked, and the operator never
 * hears about work that turned out not to be done.
 */
export async function dismissTaskCommitMatch(
  taskId: string
): Promise<{ success: true; restoredStatus: TaskStatus | null } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = taskIdSchema.safeParse(taskId);
  if (!parsed.success) return { error: "Invalid task" };
  if (!(await isTaskMember(taskId, profile.id)))
    return { error: "You don't have access to this task." };

  const admin = createAdminClient();

  // Reverse before dismissing. The other order would leave a window where the
  // task is done, its match resolved, and nothing left pointing at the snapshot
  // that says how to put it back.
  const match = await loadPendingMatch(admin, taskId);
  const restoredStatus = match?.auto_applied_at ? match.prior_status : null;
  if (match?.auto_applied_at) {
    const failed = await reverseAutoApply(admin, taskId, match);
    if (failed) return failed;
  }

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
        action: restoredStatus
          ? "task.commit_match_auto_reverted"
          : "task.commit_match_dismissed",
        metadata: {
          shas,
          short_shas: shas.map((s) => s.slice(0, 7)),
          ...(restoredStatus ? { restored_status: restoredStatus } : {}),
        },
      })
    );
  }

  revalidatePath("/b");
  revalidatePath("/b/staging");
  return { success: true, restoredStatus };
}
