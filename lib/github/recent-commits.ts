import { unstable_cache } from "next/cache";
import { githubFetch } from "./client";
import type { EngagementRepo } from "./engagement-repo";

/**
 * The default branch's recent commits, for the "you forgot to mark this done"
 * scan (lib/actions/commit-task-matches.ts).
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

async function fetchDefaultBranchCommits(
  token: string,
  owner: string,
  name: string,
  defaultBranch: string
): Promise<ScannedCommit[]> {
  try {
    const path =
      `/repos/${owner}/${name}/commits` +
      `?sha=${encodeURIComponent(defaultBranch)}&per_page=${PER_PAGE}`;
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

const cachedFetchDefaultBranchCommits = unstable_cache(
  fetchDefaultBranchCommits,
  ["default-branch-commits"],
  { revalidate: REVALIDATE_SECONDS }
);

export function getRecentDefaultBranchCommits(
  repo: Pick<EngagementRepo, "token" | "owner" | "name" | "defaultBranch">
): Promise<ScannedCommit[]> {
  return cachedFetchDefaultBranchCommits(
    repo.token,
    repo.owner,
    repo.name,
    repo.defaultBranch
  );
}
