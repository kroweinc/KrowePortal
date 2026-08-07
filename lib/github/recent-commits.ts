import { unstable_cache } from "next/cache";
import { githubFetch } from "./client";
import type { EngagementRepo } from "./engagement-repo";

/**
 * Recent commits for the "you forgot to mark this done" scan
 * (lib/actions/commit-task-matches.ts).
 *
 * Scans more than the default branch: under a feature → dev → main flow, work is
 * finished on an integration branch and only reaches main weeks later, by which
 * point the reminder is worthless. Callers pass the branches to look at, default
 * branch first.
 *
 * Deliberately not fetchRepoInsights: that one is uncached by design and also
 * pulls repo metadata and releases the scan has no use for. This runs on every
 * Build Board mount, so it needs its own cache window.
 */

// Matches the merged-PR cache window. Long enough that reloading the board a few
// times costs one request, short enough that a fresh push shows up promptly.
const REVALIDATE_SECONDS = 300;

// A scan only ever needs the recent tip of the branch — anything older has
// already been scanned and memoized in commit_task_matches.
const PER_PAGE = 30;

export type ScannedCommit = {
  sha: string;
  /** Full message (subject + body); the matcher truncates it for the prompt. */
  message: string;
  url: string;
  authorName: string | null;
  authorLogin: string | null;
  committedAt: string | null;
};

/** A scanned commit plus the branch it was found on (default branch wins ties). */
export type ScannedCommitOnBranch = ScannedCommit & { branch: string };

type CommitListItem = {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { name?: string; date?: string } | null;
    committer: { date?: string } | null;
  };
  author: { login: string } | null;
};

async function fetchBranchCommits(
  token: string,
  owner: string,
  name: string,
  branch: string
): Promise<ScannedCommit[]> {
  try {
    const path =
      `/repos/${owner}/${name}/commits` +
      `?sha=${encodeURIComponent(branch)}&per_page=${PER_PAGE}`;
    const items = await githubFetch<CommitListItem[]>(path, token);
    return items.map((c) => ({
      sha: c.sha,
      message: c.commit?.message ?? "",
      url: c.html_url,
      authorName: c.commit?.author?.name ?? null,
      authorLogin: c.author?.login ?? null,
      committedAt: c.commit?.committer?.date ?? c.commit?.author?.date ?? null,
    }));
  } catch {
    // Rate limit / auth / network. No commits means no suggestions this pass,
    // which is the right failure: the scan is a safeguard, never a blocker.
    return [];
  }
}

const cachedFetchBranchCommits = unstable_cache(fetchBranchCommits, ["branch-commits"], {
  revalidate: REVALIDATE_SECONDS,
});

/**
 * The current tip of the default branch — the identity of "what is live right
 * now". Push detection compares this against the newest release on the ledger.
 *
 * Deliberately the branch tip and not the merged-PR list: pushes to main here
 * mostly do not go through a pull request (the builder merges locally and pushes
 * the branch), so the PR API reports nothing happened. Shares the cache entry
 * with the commit scan below, so on a board that has already loaded this is free.
 *
 * `fresh` skips that shared entry. The window is 300s and every builder page
 * warms it (the layout sweep, the commit scan, the board itself), so a cached
 * read answers "did anything just ship?" with a tip from up to five minutes ago —
 * which is exactly the moment someone presses "Check for pushes". An explicit
 * check has to actually go and look; the background sweep still reads the cache.
 */
export async function getDefaultBranchTip(
  repo: Pick<EngagementRepo, "token" | "owner" | "name" | "defaultBranch">,
  opts: { fresh?: boolean } = {}
): Promise<ScannedCommit | null> {
  const read = opts.fresh ? fetchBranchCommits : cachedFetchBranchCommits;
  const commits = await read(repo.token, repo.owner, repo.name, repo.defaultBranch);
  return commits[0] ?? null;
}

/**
 * Recent commits across several branches, deduped by sha. First branch listed
 * wins the label, so pass the default branch first: a commit that has reached
 * main is reported as being on main even though it is also still on `dev`, and
 * that distinction is what decides whether confirming a match may ship the task.
 */
export async function getRecentCommitsForBranches(
  repo: Pick<EngagementRepo, "token" | "owner" | "name">,
  branches: string[]
): Promise<ScannedCommitOnBranch[]> {
  const seen = new Set<string>();
  const scanned: ScannedCommitOnBranch[] = [];
  for (const branch of branches) {
    const commits = await cachedFetchBranchCommits(
      repo.token,
      repo.owner,
      repo.name,
      branch
    );
    for (const c of commits) {
      if (seen.has(c.sha)) continue;
      seen.add(c.sha);
      scanned.push({ ...c, branch });
    }
  }
  return scanned;
}
