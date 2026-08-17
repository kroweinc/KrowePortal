"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import {
  getEngagementRepoForTask,
  getEngagementRepoById,
  type EngagementRepo,
} from "@/lib/github/engagement-repo";
import { fetchBranchNames } from "@/lib/github/branches";
import { isUniqueViolation } from "@/lib/supabase/errors";
import {
  reconcileLocalBranches,
  validateBranchName,
} from "@/lib/tasks/local-branches";

export type EngagementBranch = {
  name: string;
  purpose: string | null;
  // True for a branch the builder typed in rather than one GitHub listed — work
  // on a branch that was never pushed (migration 0091). Rendered with a "local"
  // tag so the picker doesn't claim the repo has a branch it doesn't.
  local: boolean;
};

// Preloaded branch list for one engagement's repo — passed from the builder
// server pages into the detail sheet so the chips paint with zero fetch.
export type PreloadedBranches = {
  defaultBranch: string | null;
  branches: EngagementBranch[];
};

// How long a cached branch list is trusted before a read re-pulls it from
// GitHub. Deliberately short: a branch you just deleted should disappear from
// the pickers on the next open, not on the next half hour. Affordable only
// because syncRepoBranches is a single GitHub request (see fetchBranchNames) —
// it used to cost ~145, which is what forced the old 30-minute window.
const REPO_BRANCHES_TTL_MS = 60 * 1000;

function isStale(syncedAtIso: string): boolean {
  const t = Date.parse(syncedAtIso);
  return !Number.isFinite(t) || Date.now() - t > REPO_BRANCHES_TTL_MS;
}

// Dedupe, drop empties, float the default branch to the top, then alphabetical
// — the same ordering getEngagementBranches applies to the live graph.
function orderNames(names: string[], defaultBranch: string | null): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const n of names) {
    if (n && !seen.has(n)) {
      seen.add(n);
      unique.push(n);
    }
  }
  unique.sort((a, b) => {
    if (a === defaultBranch) return -1;
    if (b === defaultBranch) return 1;
    return a.localeCompare(b);
  });
  return unique;
}

// Cached rows → the ordered chip list, carrying which names are hand-added.
function toBranches(
  rows: { branch_name: string; source?: string | null }[],
  defaultBranch: string | null,
  purposes: Record<string, string>
): EngagementBranch[] {
  const local = new Set(
    rows.filter((r) => r.source === "local").map((r) => r.branch_name)
  );
  return orderNames(
    rows.map((r) => r.branch_name),
    defaultBranch
  ).map((name) => ({
    name,
    purpose: purposes[name] ?? null,
    local: local.has(name),
  }));
}

export type EngagementBranchesResult = {
  // false = personal task or engagement with no linked GitHub repo. The done
  // dialog hides the branch picker in that case.
  hasRepo: boolean;
  repoFullName: string | null;
  defaultBranch: string | null;
  branches: EngagementBranch[];
};

const EMPTY: EngagementBranchesResult = {
  hasRepo: false,
  repoFullName: null,
  defaultBranch: null,
  branches: [],
};

/**
 * Cached branch "purpose" one-liners for a repo, keyed by branch name (latest
 * generated wins). Read-only against branch_purposes — never triggers AI
 * generation, so it's cheap to call on the staging page and the done dialog.
 * Reused by the staging view to label branch groups.
 */
export async function getCachedBranchPurposes(
  repoFullName: string
): Promise<Record<string, string>> {
  if (!repoFullName) return {};
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("branch_purposes")
    .select("branch_name, purpose, generated_at")
    .eq("repo_full_name", repoFullName)
    .order("generated_at", { ascending: false });

  if (error || !data) return {};

  const out: Record<string, string> = {};
  // Rows are newest-first, so the first time we see a branch name is the latest.
  for (const row of data as { branch_name: string; purpose: string }[]) {
    if (!(row.branch_name in out)) out[row.branch_name] = row.purpose;
  }
  return out;
}

/**
 * Move a hand-typed branch onto the name GitHub gave it once the push landed:
 * every task filed under the old spelling is repointed, then the local row is
 * dropped so the GitHub row upserted alongside it is the only chip left.
 *
 * Task scope mirrors how the pickers resolve this repo in the first place —
 * engagements pinned to it, plus the personal (no-engagement) tasks of builders
 * who have it selected. `updated_at` is deliberately untouched: this is the
 * portal correcting its own spelling, not the builder editing the task, and
 * bumping it would reshuffle every board that sorts on recency.
 */
async function renameLocalBranch(
  supabase: ReturnType<typeof createAdminClient>,
  repoFullName: string,
  from: string,
  to: string
): Promise<void> {
  const { data: engagements } = await supabase
    .from("engagements")
    .select("id")
    .eq("github_repo_full_name", repoFullName);
  const engagementIds = ((engagements ?? []) as { id: string }[]).map((e) => e.id);
  if (engagementIds.length > 0) {
    await supabase
      .from("tasks")
      .update({ branch_name: to })
      .eq("branch_name", from)
      .in("engagement_id", engagementIds);
  }

  const { data: owners } = await supabase
    .from("github_connections")
    .select("user_id")
    .eq("selected_repo_full_name", repoFullName);
  const ownerIds = ((owners ?? []) as { user_id: string }[]).map((o) => o.user_id);
  if (ownerIds.length > 0) {
    await supabase
      .from("tasks")
      .update({ branch_name: to })
      .eq("branch_name", from)
      .is("engagement_id", null)
      .in("created_by", ownerIds);
  }

  await supabase
    .from("repo_branches")
    .delete()
    .eq("repo_full_name", repoFullName)
    .eq("branch_name", from)
    .eq("source", "local");
}

/**
 * Refresh the persisted branch list for a repo from GitHub. Upserts every live
 * branch and deletes rows for branches that no longer exist — so the DB cache
 * tracks the repo as branches are pushed and deleted. Service-role only.
 *
 * Reads names **live** (fetchBranchNames) rather than through any cached graph.
 * This function is what synced_at freshness is judged by, so a cached read would
 * re-persist an already-stale snapshot and stamp it fresh: a deleted branch
 * would survive the sweep *and* suppress the next resync that would have caught
 * it. One GitHub request, so callers can await it on a read path.
 */
export async function syncRepoBranches(repo: EngagementRepo): Promise<void> {
  const live = await fetchBranchNames(repo.token, repo.owner, repo.name);
  // null = GitHub was unreachable. Leave the cache alone rather than sweeping it
  // to empty on a transient failure.
  if (!live) return;

  const names = orderNames(live.names, repo.defaultBranch);

  const supabase = createAdminClient();
  const now = new Date().toISOString();

  // Hand-added branches are invisible to GitHub, so the sweep below spares them.
  // But a push can turn one real — under the name the builder typed, or under a
  // near-miss spelling of it — and then the repo would carry two chips for one
  // branch. Reconcile before the upsert: an exact match needs nothing (the
  // upsert rewrites the row as a GitHub branch), a near match moves the row and
  // the tasks filed under it onto GitHub's name.
  if (names.length > 0) {
    const { data: localRows } = await supabase
      .from("repo_branches")
      .select("branch_name")
      .eq("repo_full_name", repo.fullName)
      .eq("source", "local");

    const localNames = ((localRows ?? []) as { branch_name: string }[]).map(
      (r) => r.branch_name
    );
    if (localNames.length > 0) {
      const { renamed } = reconcileLocalBranches(localNames, names);
      for (const { from, to } of renamed) {
        await renameLocalBranch(supabase, repo.fullName, from, to);
      }
    }
  }

  // No names means the repo genuinely has no branches — skip the upsert, but
  // still sweep below so the cache empties out with it.
  if (names.length > 0) {
    const rows = names.map((branch_name) => ({
      repo_full_name: repo.fullName,
      branch_name,
      is_default: branch_name === repo.defaultBranch,
      source: "github",
      synced_at: now,
    }));

    const { error } = await supabase
      .from("repo_branches")
      .upsert(rows, { onConflict: "repo_full_name,branch_name" });
    if (error) return;
  }

  // Only sweep when we hold the repo's *whole* branch list — on a truncated or
  // partially-failed listing, a live branch missing from `names` would be
  // deleted from the cache.
  if (!live.complete) return;

  // Sweep branches that vanished from the repo: any row for this repo we didn't
  // just re-stamp keeps its older synced_at. Comparing against `now` avoids
  // embedding (possibly slash/quote-laden) branch names in a PostgREST filter.
  // Local rows are exempt — GitHub never listed them, so "missing from the
  // listing" says nothing about them, and nothing else would ever re-stamp one.
  await supabase
    .from("repo_branches")
    .delete()
    .eq("repo_full_name", repo.fullName)
    .eq("source", "github")
    .lt("synced_at", now);
}

/**
 * Branch list for a task's engagement repo, read from the persisted cache.
 *
 * When the rows are cold or older than the TTL this re-pulls from GitHub
 * **inline** and returns the fresh list. It used to hand back the stale rows and
 * defer the sync to `after()`, which meant a branch deleted on GitHub kept
 * showing in the pickers for the whole of the current visit — the sweep only
 * landed after the response had already been rendered from the old list. Waiting
 * on one GitHub request is the cheaper trade.
 */
export async function getEngagementBranchesCached(
  taskId: string
): Promise<EngagementBranchesResult> {
  const profile = await getCurrentProfile();
  if (!profile) return EMPTY;

  const repo = await getEngagementRepoForTask(taskId, profile.id);
  if (!repo) return EMPTY;

  const supabase = createAdminClient();
  const read = async () =>
    ((
      await supabase
        .from("repo_branches")
        .select("branch_name, source, synced_at")
        .eq("repo_full_name", repo.fullName)
    ).data ?? []) as { branch_name: string; source: string; synced_at: string }[];

  let rows = await read();
  // Freshness is a property of the GitHub half of the cache. A local branch
  // carries the time it was typed and nothing ever re-stamps it, so counting it
  // here would make a repo look permanently stale and re-pull GitHub on every
  // single read.
  const newest = rows.reduce(
    (max, r) => (r.source !== "local" && r.synced_at > max ? r.synced_at : max),
    ""
  );

  if (newest === "" || isStale(newest)) {
    await syncRepoBranches(repo).catch(() => {});
    rows = await read();
  }

  const purposes = await getCachedBranchPurposes(repo.fullName);
  return {
    hasRepo: true,
    repoFullName: repo.fullName,
    defaultBranch: repo.defaultBranch,
    branches: toBranches(rows, repo.defaultBranch, purposes),
  };
}

/**
 * Record a branch the builder names by hand, for work that lives on a branch
 * GitHub has never seen — the common case when nobody but the builder pushes.
 * It joins the chips immediately and survives the GitHub sweep; the next sync
 * that finds it pushed folds it back into the real branch (see syncRepoBranches).
 *
 * Returns the refreshed list so the caller repaints from one round trip.
 */
export async function addLocalBranch(
  taskId: string,
  name: string
): Promise<EngagementBranchesResult | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Sign in to add a branch." };

  const checked = validateBranchName(name);
  if ("error" in checked) return { error: checked.error };

  const repo = await getEngagementRepoForTask(taskId, profile.id);
  if (!repo) return { error: "No GitHub repo is linked to this task." };
  // Naming a branch is the builder's call. An operator reviewing a deliverable
  // is a member of the engagement but has no branch to name. (Personal tasks
  // resolve to the caller's own repo and carry no builderId, so they pass.)
  if (repo.builderId && repo.builderId !== profile.id) {
    return { error: "Only the builder can add a branch." };
  }

  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from("repo_branches")
    .select("branch_name")
    .eq("repo_full_name", repo.fullName)
    .eq("branch_name", checked.name)
    .maybeSingle();

  // Already on the repo — GitHub listed it, or another builder typed it first.
  // Fall through to the reread rather than inserting: an upsert here would
  // demote a real GitHub branch to "local" and exempt it from the sweep.
  if (!existing) {
    const { error } = await supabase.from("repo_branches").insert({
      repo_full_name: repo.fullName,
      branch_name: checked.name,
      is_default: false,
      source: "local",
      synced_at: new Date().toISOString(),
    });
    if (error && !isUniqueViolation(error)) {
      return { error: "Couldn't add that branch. Try again." };
    }
  }

  revalidatePath("/b");
  revalidatePath("/b/staging");
  return getEngagementBranchesCached(taskId);
}

/**
 * Drop a hand-added branch — the escape hatch for a typo, which nothing else
 * would ever clear (a local row outlives every GitHub sync by design). Scoped to
 * `source = 'local'`, so this can never delete a branch that actually exists on
 * the repo. Tasks already filed under the name keep it; the staging board still
 * groups them, the chip just stops being offered.
 */
export async function removeLocalBranch(
  taskId: string,
  name: string
): Promise<EngagementBranchesResult | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Sign in to remove a branch." };

  const repo = await getEngagementRepoForTask(taskId, profile.id);
  if (!repo) return { error: "No GitHub repo is linked to this task." };
  if (repo.builderId && repo.builderId !== profile.id) {
    return { error: "Only the builder can remove a branch." };
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("repo_branches")
    .delete()
    .eq("repo_full_name", repo.fullName)
    .eq("branch_name", name)
    .eq("source", "local");
  if (error) return { error: "Couldn't remove that branch. Try again." };

  revalidatePath("/b");
  revalidatePath("/b/staging");
  return getEngagementBranchesCached(taskId);
}

/**
 * Force a live re-pull of a task's engagement repo branches, wired to the
 * picker's Refresh button. Syncs the cache, revalidates the boards, and returns
 * the freshly cached list.
 */
export async function refreshEngagementBranches(
  taskId: string
): Promise<EngagementBranchesResult> {
  const profile = await getCurrentProfile();
  if (!profile) return EMPTY;

  const repo = await getEngagementRepoForTask(taskId, profile.id);
  if (!repo) return EMPTY;

  await syncRepoBranches(repo);
  revalidatePath("/b");
  revalidatePath("/b/staging");
  return getEngagementBranchesCached(taskId);
}

/**
 * Warm and freshen the persisted branch cache for the current builder's
 * engagement repos, in the background (safe to call from `after()`). Resolves
 * each engagement's repo, dedupes by full name, and re-syncs from GitHub only
 * when the cache is cold or stale — so a builder who reloads the board has a
 * warm, current branch list waiting before they open any deliverable picker,
 * and repeated navigation never re-crawls GitHub.
 */
export async function warmEngagementBranches(): Promise<void> {
  const profile = await getCurrentProfile();
  if (!profile) return;

  const supabase = createAdminClient();
  const { data: engagements } = await supabase
    .from("engagements")
    .select("id, github_repo_full_name")
    .eq("builder_id", profile.id)
    .not("started_at", "is", null);
  if (!engagements || engagements.length === 0) return;

  // One engagement per repo, so a repo shared across engagements syncs once.
  const engagementByRepo = new Map<string, string>();
  for (const e of engagements as {
    id: string;
    github_repo_full_name: string | null;
  }[]) {
    if (!e.github_repo_full_name || engagementByRepo.has(e.github_repo_full_name)) {
      continue;
    }
    engagementByRepo.set(e.github_repo_full_name, e.id);
  }
  if (engagementByRepo.size === 0) return;

  // Freshness check first: resolving a repo costs several queries plus a token
  // decrypt, so don't pay it for repos the cache already tracks. That's what
  // keeps this cheap enough to await on a page that renders branch groups.
  // GitHub rows only: a local branch carries the time it was typed and nothing
  // re-stamps it, so counting one would either mask a stale cache (just added)
  // or make the repo look permanently stale (added long ago).
  const { data: rows } = await supabase
    .from("repo_branches")
    .select("repo_full_name, synced_at")
    .eq("source", "github")
    .in("repo_full_name", Array.from(engagementByRepo.keys()));

  const newest = new Map<string, string>();
  for (const row of (rows ?? []) as {
    repo_full_name: string;
    synced_at: string;
  }[]) {
    const cur = newest.get(row.repo_full_name);
    if (!cur || row.synced_at > cur) newest.set(row.repo_full_name, row.synced_at);
  }

  for (const [fullName, engagementId] of engagementByRepo) {
    const n = newest.get(fullName);
    if (n && !isStale(n)) continue;
    const repo = await getEngagementRepoById(engagementId, profile.id);
    if (repo) await syncRepoBranches(repo).catch(() => {});
  }
}

/**
 * Preload the persisted branch list for a set of engagements, keyed by
 * engagement id. Read-only against repo_branches (no GitHub call), so the
 * builder server pages can thread branches straight into the detail sheet.
 * Engagements whose repo isn't cached yet return empty — the field falls back
 * to the cached fast read on open.
 */
export async function getBranchesByEngagement(
  engagements: {
    id: string;
    github_repo_full_name?: string | null;
    github_default_branch?: string | null;
  }[]
): Promise<Record<string, PreloadedBranches>> {
  const repoByEngagement = new Map<
    string,
    { fullName: string; defaultBranch: string | null }
  >();
  const repoNames = new Set<string>();
  for (const e of engagements) {
    if (e.github_repo_full_name) {
      repoByEngagement.set(e.id, {
        fullName: e.github_repo_full_name,
        defaultBranch: e.github_default_branch ?? null,
      });
      repoNames.add(e.github_repo_full_name);
    }
  }
  if (repoNames.size === 0) return {};

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("repo_branches")
    .select("repo_full_name, branch_name, source")
    .in("repo_full_name", Array.from(repoNames));

  type CachedRow = { repo_full_name: string; branch_name: string; source: string };
  const rowsByRepo = new Map<string, CachedRow[]>();
  for (const row of (data ?? []) as CachedRow[]) {
    const arr = rowsByRepo.get(row.repo_full_name) ?? [];
    arr.push(row);
    rowsByRepo.set(row.repo_full_name, arr);
  }

  const purposeEntries = await Promise.all(
    Array.from(repoNames).map(
      async (r) => [r, await getCachedBranchPurposes(r)] as const
    )
  );
  const purposesByRepo = new Map(purposeEntries);

  const out: Record<string, PreloadedBranches> = {};
  for (const [engagementId, repo] of repoByEngagement) {
    out[engagementId] = {
      defaultBranch: repo.defaultBranch,
      branches: toBranches(
        rowsByRepo.get(repo.fullName) ?? [],
        repo.defaultBranch,
        purposesByRepo.get(repo.fullName) ?? {}
      ),
    };
  }
  return out;
}
