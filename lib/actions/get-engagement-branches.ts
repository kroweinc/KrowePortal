"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import {
  getEngagementRepoForTask,
  type EngagementRepo,
} from "@/lib/github/engagement-repo";
import { buildBranchGraph, type BranchNode } from "@/lib/github/branches";

export type EngagementBranch = { name: string; purpose: string | null };

// Preloaded branch list for one engagement's repo — passed from the builder
// server pages into the detail sheet so the chips paint with zero fetch.
export type PreloadedBranches = {
  defaultBranch: string | null;
  branches: EngagementBranch[];
};

// The branch cache tracks the repo within this window; older rows trigger a
// background re-sync. Matches the branch-graph unstable_cache TTL.
const REPO_BRANCHES_TTL_MS = 1800 * 1000;

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

function flattenNames(node: BranchNode, out: string[]): void {
  if (node.name) out.push(node.name);
  for (const child of node.children) flattenNames(child, out);
}

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
 * The engagement repo's branch list for a task, for the done-dialog branch
 * picker. Reuses the cached branch graph (30-min TTL) and cached purposes;
 * returns hasRepo=false when the task has no linked repo so the caller can
 * degrade gracefully.
 */
export async function getEngagementBranches(
  taskId: string
): Promise<EngagementBranchesResult> {
  const profile = await getCurrentProfile();
  if (!profile) return EMPTY;

  const repo = await getEngagementRepoForTask(taskId, profile.id);
  if (!repo) return EMPTY;

  const graph = await buildBranchGraph(
    repo.token,
    repo.owner,
    repo.name,
    repo.defaultBranch
  );
  if (!graph) {
    return {
      hasRepo: true,
      repoFullName: repo.fullName,
      defaultBranch: repo.defaultBranch,
      branches: [],
    };
  }

  const flat: string[] = [];
  flattenNames(graph.root, flat);

  // De-dupe and drop empty names (the graph synthesizes an empty default entry
  // for repos with no branches). Default branch floats to the top.
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const name of flat) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    ordered.push(name);
  }
  ordered.sort((a, b) => {
    if (a === repo.defaultBranch) return -1;
    if (b === repo.defaultBranch) return 1;
    return a.localeCompare(b);
  });

  const purposes = await getCachedBranchPurposes(repo.fullName);
  const branches: EngagementBranch[] = ordered.map((name) => ({
    name,
    purpose: purposes[name] ?? null,
  }));

  return {
    hasRepo: true,
    repoFullName: repo.fullName,
    defaultBranch: repo.defaultBranch,
    branches,
  };
}

/**
 * Refresh the persisted branch list for a repo from GitHub. Reuses the cached
 * branch graph (30-min TTL), upserts every live branch, and deletes rows for
 * branches that no longer exist — so the DB cache tracks the repo as branches
 * are pushed and deleted. Service-role only; safe to call from `after()`.
 */
export async function syncRepoBranches(repo: EngagementRepo): Promise<void> {
  const graph = await buildBranchGraph(
    repo.token,
    repo.owner,
    repo.name,
    repo.defaultBranch
  );
  if (!graph) return;

  const flat: string[] = [];
  flattenNames(graph.root, flat);
  const names = orderNames(flat, repo.defaultBranch);
  if (names.length === 0) return;

  const supabase = createAdminClient();
  const now = new Date().toISOString();
  const rows = names.map((branch_name) => ({
    repo_full_name: repo.fullName,
    branch_name,
    is_default: branch_name === repo.defaultBranch,
    synced_at: now,
  }));

  const { error } = await supabase
    .from("repo_branches")
    .upsert(rows, { onConflict: "repo_full_name,branch_name" });
  if (error) return;

  // Sweep branches that vanished from the repo: any row for this repo we didn't
  // just re-stamp keeps its older synced_at. Comparing against `now` avoids
  // embedding (possibly slash/quote-laden) branch names in a PostgREST filter.
  await supabase
    .from("repo_branches")
    .delete()
    .eq("repo_full_name", repo.fullName)
    .lt("synced_at", now);
}

/**
 * Branch list for a task's engagement repo, read from the persisted cache so it
 * paints instantly (no GitHub round-trip). Warms the cache on a miss and kicks
 * a background re-sync when the rows are stale, so the list stays current.
 * Same result shape as getEngagementBranches — a drop-in for the pickers.
 */
export async function getEngagementBranchesCached(
  taskId: string
): Promise<EngagementBranchesResult> {
  const profile = await getCurrentProfile();
  if (!profile) return EMPTY;

  const repo = await getEngagementRepoForTask(taskId, profile.id);
  if (!repo) return EMPTY;

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("repo_branches")
    .select("branch_name, is_default, synced_at")
    .eq("repo_full_name", repo.fullName);

  // Cold cache — fall back to the live graph and warm the cache in the
  // background so the next open is instant.
  if (!data || data.length === 0) {
    after(() => syncRepoBranches(repo).catch(() => {}));
    return getEngagementBranches(taskId);
  }

  const newest = data.reduce(
    (max, r) => (r.synced_at > max ? r.synced_at : max),
    ""
  );
  if (isStale(newest)) {
    after(() => syncRepoBranches(repo).catch(() => {}));
  }

  const ordered = orderNames(
    data.map((r) => r.branch_name),
    repo.defaultBranch
  );
  const purposes = await getCachedBranchPurposes(repo.fullName);
  return {
    hasRepo: true,
    repoFullName: repo.fullName,
    defaultBranch: repo.defaultBranch,
    branches: ordered.map((name) => ({ name, purpose: purposes[name] ?? null })),
  };
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
    .select("repo_full_name, branch_name")
    .in("repo_full_name", Array.from(repoNames));

  const namesByRepo = new Map<string, string[]>();
  for (const row of (data ?? []) as { repo_full_name: string; branch_name: string }[]) {
    const arr = namesByRepo.get(row.repo_full_name) ?? [];
    arr.push(row.branch_name);
    namesByRepo.set(row.repo_full_name, arr);
  }

  const purposeEntries = await Promise.all(
    Array.from(repoNames).map(
      async (r) => [r, await getCachedBranchPurposes(r)] as const
    )
  );
  const purposesByRepo = new Map(purposeEntries);

  const out: Record<string, PreloadedBranches> = {};
  for (const [engagementId, repo] of repoByEngagement) {
    const ordered = orderNames(
      namesByRepo.get(repo.fullName) ?? [],
      repo.defaultBranch
    );
    const purposes = purposesByRepo.get(repo.fullName) ?? {};
    out[engagementId] = {
      defaultBranch: repo.defaultBranch,
      branches: ordered.map((name) => ({ name, purpose: purposes[name] ?? null })),
    };
  }
  return out;
}
