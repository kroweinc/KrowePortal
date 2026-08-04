import { unstable_cache } from "next/cache";
import { githubFetch } from "./client";
import type { EngagementRepo } from "./engagement-repo";

// Short TTL so repeated staging-board loads don't hammer the PRs API, matching
// the branch-graph cache window.
const REVALIDATE_SECONDS = 300;

export type MergedPrLike = {
  merged_at: string | null;
  merge_commit_sha: string | null;
  head?: { ref?: string | null } | null;
};

/** One push to the default branch: the merge that carried it, and the branch it
 *  came from (a label for the timeline, never a grouping key). */
export type MainMerge = { sha: string; headRef: string | null; mergedAt: string };

/**
 * Every merged PR in the listing, newest merge first.
 *
 * Sorts on `merged_at` rather than trusting list order: GitHub sorts by *update*
 * time, so a comment on a long-merged PR floats it back to the top. Pure so it
 * can be unit-tested independently of the network fetch.
 */
export function sortMerges(pulls: MergedPrLike[]): MainMerge[] {
  const merges: MainMerge[] = [];
  for (const pr of pulls) {
    if (!pr.merged_at || !pr.merge_commit_sha) continue;
    merges.push({
      sha: pr.merge_commit_sha,
      headRef: pr.head?.ref?.trim() || null,
      mergedAt: pr.merged_at,
    });
  }
  return merges.sort((a, b) => (a.mergedAt < b.mergedAt ? 1 : a.mergedAt > b.mergedAt ? -1 : 0));
}

/** The most recent push to the default branch, whatever branch carried it. */
export function pickLatestMerge(pulls: MergedPrLike[]): MainMerge | null {
  return sortMerges(pulls)[0] ?? null;
}

/**
 * The branches that recently fed the default branch, newest first — `dev` for a
 * feature → dev → main flow. These are where finished work lives *before* it
 * reaches main, which is where the forgot-to-mark-done scan has to look if it
 * wants to catch anything while the reminder is still worth having.
 */
export function pickMergeHeads(merges: MainMerge[], limit: number): string[] {
  const heads: string[] = [];
  for (const m of merges) {
    if (m.headRef === null || heads.includes(m.headRef)) continue;
    heads.push(m.headRef);
    if (heads.length >= limit) break;
  }
  return heads;
}

/**
 * The newest merge into the repo's default branch, or null when there is none
 * (or the API is unavailable — we fail closed and never ship on an error).
 *
 * Keys on merged PRs rather than commit ancestry so squash and rebase merges —
 * where a branch's commits never literally land on main — still register.
 * Deliberately unfiltered by head branch: work reaches main through whatever
 * integration branch the builder uses, so the push is the unit, not the branch.
 */
async function fetchMainMerges(
  token: string,
  owner: string,
  name: string,
  defaultBranch: string
): Promise<MainMerge[]> {
  try {
    const path =
      `/repos/${owner}/${name}/pulls` +
      `?state=closed&base=${encodeURIComponent(defaultBranch)}` +
      `&sort=updated&direction=desc&per_page=20`;
    const pulls = await githubFetch<MergedPrLike[]>(path, token);
    return sortMerges(pulls);
  } catch {
    // Rate limit / auth / network — treat as "unknown", never ship on a failure.
    return [];
  }
}

// One cached listing serves both readers below: the ship poll wants the newest
// merge, the commit scan wants the branches that produced them.
const cachedFetchMainMerges = unstable_cache(fetchMainMerges, ["main-merges"], {
  revalidate: REVALIDATE_SECONDS,
});

type RepoRef = Pick<EngagementRepo, "token" | "owner" | "name" | "defaultBranch">;

export async function getLatestMainMerge(repo: RepoRef): Promise<MainMerge | null> {
  const merges = await cachedFetchMainMerges(
    repo.token,
    repo.owner,
    repo.name,
    repo.defaultBranch
  );
  return merges[0] ?? null;
}

/** The branches recently merged into the default branch, newest first. */
export async function getMainMergeHeads(
  repo: RepoRef,
  limit: number
): Promise<string[]> {
  const merges = await cachedFetchMainMerges(
    repo.token,
    repo.owner,
    repo.name,
    repo.defaultBranch
  );
  return pickMergeHeads(merges, limit);
}
