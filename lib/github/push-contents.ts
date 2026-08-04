import { unstable_cache } from "next/cache";
import { githubFetch } from "./client";
import type { EngagementRepo } from "./engagement-repo";

/**
 * What a push to main actually carried — the input to the untracked-work scan
 * (lib/actions/release-gaps.ts).
 *
 * The commit *messages* alone are the ceiling the commit matcher already runs
 * into ("you do NOT have the diff", buildMatchCommitsSystemPrompt). Naming work
 * nobody wrote a task for needs more than that: a push whose every subject is
 * "wip" is unreadable, but `app/api/agent/pdf/route.ts` says exactly what
 * shipped. So this fetches the changed paths too.
 *
 * Paths only — never `patch` bodies. A file list is a few hundred tokens and a
 * combined diff is tens of thousands, and the paths are what carry the meaning.
 */

// Content-addressed by sha: the contents of a commit never change, so this only
// ever expires to keep the cache from growing. Matches the branch-graph window.
const REVALIDATE_SECONDS = 1800;

/** Changed paths sent to the model. Beyond this it's reading a directory
 *  listing, not a summary — and GitHub itself stops at 300 per response. */
const MAX_FILES = 100;

export type PushFile = {
  path: string;
  /** GitHub's status: added | modified | removed | renamed | copied | changed. */
  status: string;
  /** additions + deletions — the sort key when the list has to be cut. */
  churn: number;
};

export type PushCommit = {
  sha: string;
  /** First line only; bodies are noise at this size. */
  subject: string;
  url: string;
};

export type PushContents = {
  sha: string;
  subject: string;
  /** Every commit the push brought in, newest first. */
  commits: PushCommit[];
  files: PushFile[];
  /** True when files were cut — the prompt says so rather than implying the
   *  push touched only what it can see. */
  filesTruncated: boolean;
};

/** A file entry as GitHub reports it, before it's cut down to a PushFile. */
export type GhFile = {
  filename: string;
  status: string;
  additions?: number;
  deletions?: number;
};

type GhCommitDetail = {
  sha: string;
  html_url: string;
  commit: { message: string };
  parents: { sha: string }[];
  files?: GhFile[];
};

type GhCompareResult = {
  commits?: { sha: string; html_url: string; commit: { message: string } }[];
  files?: GhFile[];
};

function subjectOf(message: string): string {
  return (message ?? "").split("\n")[0].trim().slice(0, 300);
}

/**
 * Cut a file list down to what's worth showing the model, biggest change first.
 *
 * Sorted by churn rather than truncated in place because GitHub returns files
 * alphabetically: a straight `slice` on a wide push keeps everything under `a/`
 * and drops the one route that explains what shipped.
 */
export function pickPushFiles(
  files: GhFile[],
  cap: number = MAX_FILES
): { files: PushFile[]; truncated: boolean } {
  const mapped: PushFile[] = files.map((f) => ({
    path: f.filename,
    status: f.status,
    churn: (f.additions ?? 0) + (f.deletions ?? 0),
  }));
  if (mapped.length <= cap) return { files: mapped, truncated: false };
  const ranked = [...mapped].sort((a, b) => b.churn - a.churn);
  return { files: ranked.slice(0, cap), truncated: true };
}

async function fetchPushContents(
  token: string,
  owner: string,
  name: string,
  sha: string
): Promise<PushContents | null> {
  try {
    // For a merge commit this returns the diff against the FIRST parent — i.e.
    // everything the merge brought in — which is precisely "what this push
    // shipped". For a plain push it's that one commit's diff.
    const head = await githubFetch<GhCommitDetail>(
      `/repos/${owner}/${name}/commits/${encodeURIComponent(sha)}`,
      token
    );

    const subject = subjectOf(head.commit?.message ?? "");
    const parents = head.parents ?? [];
    let files = head.files ?? [];
    let commits: PushCommit[] = [
      { sha: head.sha, subject, url: head.html_url },
    ];

    // A merge commit's own message says nothing about the work ("Merge branch
    // 'AgentPDF' into dev"). Comparing against the first parent yields the
    // commits it carried, which is what the scan actually reads. A plain push
    // has one parent and is already its own answer, so it skips the request.
    if (parents.length > 1) {
      try {
        const cmp = await githubFetch<GhCompareResult>(
          `/repos/${owner}/${name}/compare/${encodeURIComponent(parents[0].sha)}...${encodeURIComponent(sha)}`,
          token
        );
        const carried = (cmp.commits ?? []).map((c) => ({
          sha: c.sha,
          subject: subjectOf(c.commit?.message ?? ""),
          url: c.html_url,
        }));
        if (carried.length > 0) commits = carried.reverse();
        if ((cmp.files ?? []).length > 0) files = cmp.files ?? [];
      } catch {
        // Compare failed — the merge commit's own file list is still a usable
        // answer, so degrade to it rather than losing the whole push.
      }
    }

    const picked = pickPushFiles(files);
    return {
      sha: head.sha,
      subject,
      commits,
      files: picked.files,
      filesTruncated: picked.truncated,
    };
  } catch {
    // Rate limit / auth / deleted sha. No contents means no scan this pass,
    // which is the right failure: this is a safeguard, never a blocker.
    return null;
  }
}

const cachedFetchPushContents = unstable_cache(fetchPushContents, ["push-contents"], {
  revalidate: REVALIDATE_SECONDS,
});

/** Everything one push to main carried: its commits and the paths it changed. */
export async function getPushContents(
  repo: Pick<EngagementRepo, "token" | "owner" | "name">,
  sha: string
): Promise<PushContents | null> {
  if (!sha) return null;
  return cachedFetchPushContents(repo.token, repo.owner, repo.name, sha);
}
