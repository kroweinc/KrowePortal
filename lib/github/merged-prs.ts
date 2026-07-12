import { unstable_cache } from "next/cache";
import { githubFetch } from "./client";
import type { EngagementRepo } from "./engagement-repo";

// Short TTL so repeated staging-board loads don't hammer the PRs API, matching
// the branch-graph cache window.
const REVALIDATE_SECONDS = 300;

export type MergedPrLike = {
  merged_at: string | null;
  merge_commit_sha: string | null;
};

/**
 * The merge commit sha of the first merged PR in a closed-PR list (GitHub
 * returns them newest-first), or null when none is merged. Pure so it can be
 * unit-tested independently of the network fetch.
 */
export function pickMergedSha(pulls: MergedPrLike[]): string | null {
  for (const pr of pulls) {
    if (pr.merged_at && pr.merge_commit_sha) return pr.merge_commit_sha;
  }
  return null;
}

/**
 * Whether a freshly observed merge sha is a new push we haven't shipped yet.
 * Undo-safe: an unchanged recorded sha (even right after the builder undoes an
 * auto-move) is not re-shipped, because the recorded sha still matches.
 */
export function isNewMerge(
  recordedSha: string | null | undefined,
  mergeSha: string | null
): boolean {
  return mergeSha !== null && recordedSha !== mergeSha;
}

/**
 * Is `branch` merged into `defaultBranch`? Returns the merge commit sha of the
 * most recent merged PR from that branch into the default branch, or null when
 * there is none (or the API is unavailable — we fail closed and don't ship).
 *
 * Keys on the merge PR rather than branch-ancestry so squash and rebase merges
 * (where the branch's commits never literally land on main) are still detected.
 */
async function fetchMergedPrSha(
  token: string,
  owner: string,
  name: string,
  defaultBranch: string,
  branch: string
): Promise<string | null> {
  try {
    const path =
      `/repos/${owner}/${name}/pulls` +
      `?state=closed&base=${encodeURIComponent(defaultBranch)}` +
      `&head=${encodeURIComponent(`${owner}:${branch}`)}` +
      `&sort=updated&direction=desc&per_page=5`;
    const pulls = await githubFetch<MergedPrLike[]>(path, token);
    return pickMergedSha(pulls);
  } catch {
    // Rate limit / auth / network — treat as "unknown", never ship on a failure.
    return null;
  }
}

const cachedFetchMergedPrSha = unstable_cache(fetchMergedPrSha, ["merged-pr-sha"], {
  revalidate: REVALIDATE_SECONDS,
});

export function getMergedPrSha(
  repo: Pick<EngagementRepo, "token" | "owner" | "name" | "defaultBranch">,
  branch: string
): Promise<string | null> {
  return cachedFetchMergedPrSha(
    repo.token,
    repo.owner,
    repo.name,
    repo.defaultBranch,
    branch
  );
}
