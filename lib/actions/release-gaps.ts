"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { getEngagementRepoById, type EngagementRepo } from "@/lib/github/engagement-repo";
import { getPushContents } from "@/lib/github/push-contents";
import { findUntrackedWork } from "@/lib/ai/find-untracked-work";
import { estimateAndSaveTaskHours } from "@/lib/actions/estimate-task";
import { writeAuditEntries } from "@/lib/actions/audit-log";
import { isEngagementMember } from "@/lib/actions/task-access";
import type { TitleCandidate } from "@/lib/tasks/dedupe";
import type { ReleaseGapCommit } from "@/lib/types";

/**
 * The safeguard for work that shipped with no task behind it.
 *
 * 0081 catches the opposite mistake — work that finished an OPEN task nobody
 * closed. It can never see this one, because it matches commits against open
 * tasks only: a push containing work that was never tracked has no task to
 * match against, and every commit that finished an already-done task lands in
 * its "no match" memo too.
 *
 * The unit that answers this question is the push. A release IS one push to
 * main, and the tasks carrying its release_id are exactly what was accounted
 * for. Ask what the push contained, subtract those, and the remainder is the
 * forgotten work — proposed on the Shipped timeline as a card the builder
 * accepts or dismisses. Nothing here ever creates a task on its own.
 *
 * Costs nothing in the steady state: a release keeps gaps_scanned_at once it
 * has been looked at, so an unchanged history means zero AI calls.
 */

const pollSchema = z.array(z.string().uuid()).max(50);

/** Releases scanned per poll. Each is one AI call, run concurrently, so this is
 *  the latency ceiling of a board load — not a throughput limit. Older pushes
 *  are picked up by the next poll. */
const MAX_RELEASES_PER_POLL = 3;

/** How far back to look. A push from two months ago is history, not a nudge —
 *  and its work has long since been noticed or forgotten on purpose. */
const SCAN_WINDOW_DAYS = 30;

type ReleaseRow = {
  id: string;
  engagement_id: string | null;
  branch_name: string | null;
  merge_sha: string;
  merge_subject: string | null;
};

/** One push scanned: what the model proposed, if anything. */
type ScanResult = { found: number };

async function scanRelease(
  admin: ReturnType<typeof createAdminClient>,
  repo: EngagementRepo,
  release: ReleaseRow,
  engagementId: string,
  /** Every engagement on this repo, including `engagementId` — see
   *  groupEngagementsByRepo below for why that is more than one. */
  repoEngagementIds: string[],
  profileId: string
): Promise<ScanResult> {
  const scannedAt = new Date().toISOString();
  // Stamped in every exit path below, including the failures — see the comment
  // on gaps_scanned_at in 0086. "We looked" is the memo; "we found nothing" and
  // "we couldn't look" are the same thing to the next board load.
  const stamp = () =>
    admin.from("releases").update({ gaps_scanned_at: scannedAt }).eq("id", release.id);

  // One push, one proposal. A push to a repo backing several engagements gets a
  // release row in each, and scanning them all would put the same forgotten work
  // on three different clients' boards. The first release scanned for a given
  // (repo, sha) claims it; the rest stamp themselves and stay quiet.
  const { data: claimed } = await admin
    .from("release_gaps")
    .select("id, releases!inner(merge_sha)")
    .eq("repo_full_name", repo.fullName)
    .eq("releases.merge_sha", release.merge_sha)
    .limit(1)
    .maybeSingle();
  if (claimed) {
    await stamp();
    return { found: 0 };
  }

  const push = await getPushContents(repo, release.merge_sha);
  if (!push || push.commits.length === 0) {
    await stamp();
    return { found: 0 };
  }

  const [{ data: trackedRows }, { data: allTitles }] = await Promise.all([
    admin
      .from("tasks")
      .select("title, description")
      .eq("release_id", release.id),
    // Every title on this REPO, not just this engagement's, and not just the
    // open ones. Two reasons, both load-bearing:
    //   - This push is scanned because its work is DONE, so the task a proposal
    //     would duplicate is almost always a completed one.
    //   - One repo commonly backs several engagements (the commit matcher
    //     dedupes by repo for the same reason), and a release row exists per
    //     engagement per push. Scoping to one engagement makes every sibling
    //     re-propose work that is already tracked next door.
    admin.from("tasks").select("id, title").in("engagement_id", repoEngagementIds),
  ]);

  const trackedTasks = ((trackedRows ?? []) as { title: string; description: string | null }[]).map(
    (t) => ({ title: t.title, description: t.description })
  );
  const existingTitles = ((allTitles ?? []) as TitleCandidate[]).map((t) => ({
    id: t.id,
    title: t.title,
  }));

  const { items, model } = await findUntrackedWork(
    {
      repoFullName: repo.fullName,
      pushSubject: release.merge_subject ?? push.subject,
      branch: release.branch_name,
      commits: push.commits.map((c) => ({ sha: c.sha, subject: c.subject })),
      files: push.files.map((f) => ({ path: f.path, status: f.status })),
      filesTruncated: push.filesTruncated,
      trackedTasks,
    },
    existingTitles,
    { userId: profileId, operation: "find_untracked_work", engagementId }
  );

  if (items.length === 0) {
    await stamp();
    return { found: 0 };
  }

  const commitBySha = new Map(push.commits.map((c) => [c.sha, c]));
  const rows = items.map((item) => ({
    release_id: release.id,
    engagement_id: engagementId,
    repo_full_name: repo.fullName,
    title: item.title.slice(0, 300),
    description: item.description.slice(0, 2000),
    priority: item.priority,
    type: item.type,
    tags: item.tags,
    confidence: item.confidence,
    // Snapshotted so the card renders and accepting links commits with no
    // second GitHub call — and so it stays readable if the repo is unlinked.
    evidence: item.shas.flatMap((sha) => {
      const c = commitBySha.get(sha);
      return c ? [{ sha: c.sha, subject: c.subject, url: c.url }] : [];
    }) satisfies ReleaseGapCommit[],
    files: item.files.slice(0, 10),
    state: "pending",
    model,
  }));

  const { error } = await admin.from("release_gaps").insert(rows);
  if (error) {
    console.error("[pollReleaseGaps] write failed", {
      release: release.id,
      error: error.message,
    });
    // Deliberately NOT stamped: the scan succeeded and only the write failed,
    // so leaving it unscanned lets the next poll retry rather than silently
    // burying what it found.
    return { found: 0 };
  }

  await stamp();
  return { found: rows.length };
}

/**
 * Scan recent pushes for work that shipped without a task. Runs on staging-board
 * mount, after pollMainMerges — that call is what creates the releases this
 * reads, so the order matters.
 */
export async function pollReleaseGaps(
  engagementIds: string[]
): Promise<{ found: number }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { found: 0 };

  const parsed = pollSchema.safeParse(engagementIds);
  if (!parsed.success || parsed.data.length === 0) return { found: 0 };

  const admin = createAdminClient();
  const profileId = profile.id;
  const since = new Date(Date.now() - SCAN_WINDOW_DAYS * 86_400_000).toISOString();

  // Which engagements share a repo. One repo backing several engagements is
  // common rather than exotic here — an engagement with no repo of its own
  // falls back to the user's selected one — and a push produces a release row
  // per engagement, so without this every sibling proposes the same work.
  //
  // Resolved concurrently: each lookup is its own DB read (and a GitHub one for
  // an engagement falling back to the selected repo), and this whole poll sits
  // in front of the card appearing on the board.
  const resolved = await Promise.all(
    // Membership gate — null for anyone not on the engagement, which is also
    // what stops a builder's token being used against someone else's repo.
    parsed.data.map(async (engagementId) => ({
      engagementId,
      repo: await getEngagementRepoById(engagementId, profileId),
    }))
  );

  const repoEngagements = new Map<string, string[]>();
  const repoByEngagement = new Map<string, EngagementRepo>();
  for (const { engagementId, repo } of resolved) {
    if (!repo) continue;
    repoByEngagement.set(engagementId, repo);
    const bucket = repoEngagements.get(repo.fullName);
    if (bucket) bucket.push(engagementId);
    else repoEngagements.set(repo.fullName, [engagementId]);
  }

  async function scanEngagement(
    engagementId: string,
    repo: EngagementRepo,
    siblings: string[]
  ): Promise<number> {
    const { data } = await admin
      .from("releases")
      .select("id, engagement_id, branch_name, merge_sha, merge_subject")
      .eq("engagement_id", engagementId)
      .eq("kind", "auto")
      .not("merge_sha", "is", null)
      .is("gaps_scanned_at", null)
      .gte("shipped_at", since)
      .order("shipped_at", { ascending: false })
      .limit(MAX_RELEASES_PER_POLL);

    const releases = (data ?? []) as ReleaseRow[];
    if (releases.length === 0) return 0;

    // Concurrent: three independent AI calls, so the wall clock is one call
    // rather than three. The cap above is what keeps that safe.
    const results = await Promise.allSettled(
      releases.map((r) => scanRelease(admin, repo, r, engagementId, siblings, profileId))
    );
    let n = 0;
    for (const r of results) {
      if (r.status === "fulfilled") n += r.value.found;
      else console.error("[pollReleaseGaps] scan failed", { error: r.reason });
    }
    return n;
  }

  // Repos in parallel, engagements within a repo in series. The serialization is
  // load-bearing exactly once: scanRelease claims a (repo, sha) so siblings on
  // the same repo stay quiet, and two siblings scanning at the same moment would
  // both read an unclaimed push and both propose it. Different repos can't
  // collide, so they have no reason to wait on each other's AI call.
  const perRepo = await Promise.all(
    Array.from(repoEngagements, async ([, engagementIds]) => {
      let n = 0;
      for (const engagementId of engagementIds) {
        const repo = repoByEngagement.get(engagementId);
        if (repo) n += await scanEngagement(engagementId, repo, engagementIds);
      }
      return n;
    })
  );
  const found = perRepo.reduce((a, b) => a + b, 0);

  if (found > 0) revalidatePath("/b/staging");
  return { found };
}

const acceptSchema = z.object({
  gapId: z.string().uuid(),
  title: z.string().trim().min(3).max(300).optional(),
  description: z.string().trim().min(1).max(2000).optional(),
});

type FullGapRow = {
  id: string;
  release_id: string;
  engagement_id: string | null;
  repo_full_name: string;
  title: string;
  description: string;
  priority: string;
  type: string;
  tags: string[] | null;
  evidence: unknown;
  releases: { shipped_at: string; branch_name: string | null } | null;
};

/** Load the gap plus the push it belongs to, and confirm the caller may act on
 *  it. Builder-only: a gap is a builder's own bookkeeping, never an operator's. */
async function loadWritableGap(
  gapId: string,
  profileId: string,
  role: string
): Promise<{ gap: FullGapRow } | { error: string }> {
  if (role !== "builder") return { error: "Only the builder can resolve these." };

  const admin = createAdminClient();
  const { data } = await admin
    .from("release_gaps")
    .select(
      "id, release_id, engagement_id, repo_full_name, title, description, priority, type, tags, evidence, releases(shipped_at, branch_name)"
    )
    .eq("id", gapId)
    .eq("state", "pending")
    .maybeSingle();

  if (!data) return { error: "That suggestion is no longer available." };
  const gap = data as unknown as FullGapRow;

  if (!gap.engagement_id) return { error: "That suggestion is no longer available." };
  if (!(await isEngagementMember(gap.engagement_id, profileId)))
    return { error: "You don't have access to this client." };

  return { gap };
}

function evidenceCommits(value: unknown): ReleaseGapCommit[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const { sha, subject, url } = entry as Record<string, unknown>;
    if (typeof sha !== "string" || typeof url !== "string" || !url) return [];
    return [{ sha, subject: typeof subject === "string" ? subject : "", url }];
  });
}

/**
 * Accept the proposal: write the task the builder should have written.
 *
 * It lands already done and attached to the push that carried it — dated by the
 * push, not by now, so the Shipped timeline and the client's changelog read as
 * if the task had been there all along. The linked commits are the deliverable
 * (task_commits holds their URLs), which is why completion_note stays null —
 * DeliveryChips renders a completion_note URL as a "Live" chip, and a commit
 * link is not a live site. Same reasoning as confirmMatchedTaskDone.
 */
export async function acceptReleaseGap(
  gapId: string,
  edits?: { title?: string; description?: string }
): Promise<{ taskId: string } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = acceptSchema.safeParse({ gapId, ...edits });
  if (!parsed.success) return { error: "Invalid input" };

  const access = await loadWritableGap(parsed.data.gapId, profile.id, profile.role);
  if ("error" in access) return access;
  const { gap } = access;

  const admin = createAdminClient();
  const shippedAt = gap.releases?.shipped_at ?? new Date().toISOString();
  const now = new Date().toISOString();

  const { data: task, error } = await admin
    .from("tasks")
    .insert({
      engagement_id: gap.engagement_id,
      created_by: profile.id,
      title: parsed.data.title ?? gap.title,
      description: parsed.data.description ?? gap.description,
      priority: gap.priority,
      type: gap.type,
      tags: gap.tags ?? [],
      // The builder is writing this task about their own work, after the fact.
      source: "builder_added",
      status: "done",
      pushed_to_main: true,
      release_id: gap.release_id,
      // Dated by the push throughout. Stamping `now` would put a task completed
      // "today" inside a release that shipped last week, which is exactly the
      // inversion shipPushedTasks guards against on the other side.
      completed_at: shippedAt,
      shipped_at: shippedAt,
      branch_name: gap.releases?.branch_name ?? null,
      updated_at: now,
    })
    .select("id")
    .single();

  if (error || !task) return { error: error?.message ?? "Couldn't create that task." };
  const taskId = task.id as string;

  const commits = evidenceCommits(gap.evidence);
  // Written straight rather than through linkTaskCommit, which is a server
  // action built for a builder linking one commit by hand: it re-reads the
  // profile, re-checks task membership, and probes for a duplicate row on every
  // call. None of that can tell us anything here — the gap was authorized above
  // and the task was created a line ago, so it is empty by construction — and it
  // costs a serial round trip per commit on the click the builder is waiting on.
  const commitRows = commits.map((c) => ({
    task_id: taskId,
    repo_full_name: gap.repo_full_name,
    commit_sha: c.sha,
    commit_url: c.url,
    commit_message: c.subject || null,
    commit_author_name: null,
    commit_author_login: null,
    commit_committed_at: shippedAt,
    linked_by: profile.id,
  }));

  const [linked] = await Promise.all([
    commitRows.length > 0
      ? admin.from("task_commits").insert(commitRows)
      : Promise.resolve({ error: null }),
    admin
      .from("release_gaps")
      .update({
        state: "accepted",
        created_task_id: taskId,
        resolved_by: profile.id,
        resolved_at: now,
      })
      .eq("id", gap.id),
  ]);
  // The task itself is the answer, so a failed link doesn't fail the accept —
  // but it silently strips the deliverable off the card, so say so.
  if (linked.error) {
    console.error("[acceptReleaseGap] commit link failed", {
      task: taskId,
      error: linked.error.message,
    });
  }

  after(async () => {
    await writeAuditEntries([
      {
        taskId,
        actorId: profile.id,
        action: "task.created",
        metadata: {
          title: parsed.data.title ?? gap.title,
          source: "builder_added",
          priority: gap.priority,
          via: "release_gap",
        },
      },
      // The per-commit trail linkTaskCommit would have written, deferred with
      // the rest of the bookkeeping instead of blocking the response.
      ...commits.map((c) => ({
        taskId,
        actorId: profile.id,
        action: "task.commit_linked",
        metadata: {
          sha: c.sha,
          short_sha: c.sha.slice(0, 7),
          message: (c.subject ?? "").split("\n")[0].slice(0, 200),
          url: c.url,
          repo: gap.repo_full_name,
        },
      })),
      {
        taskId,
        actorId: profile.id,
        action: "task.release_gap_accepted",
        metadata: {
          release_id: gap.release_id,
          repo: gap.repo_full_name,
          shas: commits.map((c) => c.sha),
          short_shas: commits.map((c) => c.sha.slice(0, 7)),
        },
      },
    ]);
    await estimateAndSaveTaskHours({
      taskId,
      title: parsed.data.title ?? gap.title,
      description: parsed.data.description ?? gap.description,
      priority: gap.priority as "low" | "medium" | "high" | "urgent",
      userId: profile.id,
    });
  });

  revalidatePath("/b");
  revalidatePath("/b/staging");
  revalidatePath("/o/changelog");
  return { taskId };
}

/**
 * Reject the proposal: that wasn't work worth tracking. Retired for good — the
 * release stays scanned, so it is never proposed again.
 */
export async function dismissReleaseGap(
  gapId: string
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  if (!z.string().uuid().safeParse(gapId).success) return { error: "Invalid suggestion" };

  const access = await loadWritableGap(gapId, profile.id, profile.role);
  if ("error" in access) return access;

  const admin = createAdminClient();
  const { error } = await admin
    .from("release_gaps")
    .update({
      state: "dismissed",
      resolved_by: profile.id,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", access.gap.id);

  if (error) return { error: error.message };

  revalidatePath("/b/staging");
  return { success: true };
}
