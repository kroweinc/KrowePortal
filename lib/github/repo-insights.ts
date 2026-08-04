import { githubFetch } from "./client";

/**
 * Extra repo signals the Repo page shows that RepoContext doesn't carry:
 * social counts, a two-week commit heatmap, and per-commit CI verdicts.
 *
 * Deliberately separate from repo-context.ts — that shape feeds the AI project
 * profile and the operator view, and neither needs any of this. Every field
 * degrades to null/empty rather than failing the page, so a repo the token
 * can't read stats for still renders.
 */

export type RepoSocialStats = {
  stars: number | null;
  forks: number | null;
  watchers: number | null;
  releases: number | null;
};

/** One day in the activity strip, oldest first. */
export type ActivityDay = {
  /** YYYY-MM-DD in UTC — matches how GitHub buckets commit dates. */
  date: string;
  count: number;
};

/** GitHub's combined check verdict for a commit, or null when it has no checks. */
export type CommitCheck = "success" | "failure" | "pending";

/** Same shape as RepoContext["recentCommits"], so the UI takes either. */
export type InsightCommit = {
  sha: string;
  message: string;
  date: string;
  author: { name: string; login: string | null } | null;
};

export type RepoInsights = {
  stats: RepoSocialStats;
  activity: ActivityDay[];
  /**
   * Commits from the same two-week window as `activity`, newest first. Free —
   * they ride along on the histogram's fetch — and deep enough that the
   * Updates list actually groups across several days.
   */
  commits: InsightCommit[];
};

/** Days shown in the activity heatmap. */
export const ACTIVITY_DAYS = 14;

type RepoMeta = {
  stargazers_count: number;
  forks_count: number;
  subscribers_count: number;
};

type CommitListItem = {
  sha: string;
  commit: {
    message: string;
    author: { name?: string; date: string } | null;
    committer: { date: string } | null;
  };
  author: { login: string } | null;
};

type CheckRunsResponse = {
  check_runs: { status: string; conclusion: string | null }[];
};

/**
 * YYYY-MM-DD in the server's own timezone — the bucket key for the heatmap.
 * Deliberately local rather than UTC: the commit rows below the strip group by
 * local day too, so a UTC key would leave the evening's commits sitting in
 * tomorrow's cell while the list still calls them "today".
 */
function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * The last ACTIVITY_DAYS days, oldest first, zero-filled. Building the buckets
 * up front (rather than from whatever commits came back) keeps the strip a
 * fixed width and keeps quiet days visible as empty cells.
 */
function emptyActivity(now: Date): ActivityDay[] {
  const days: ActivityDay[] = [];
  for (let i = ACTIVITY_DAYS - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000);
    days.push({ date: dayKey(d), count: 0 });
  }
  return days;
}

/**
 * Social counts + the two-week commit histogram. One call for repo metadata
 * (stars/forks/watchers all ride along), one for releases, one for the commit
 * window. Each is independently optional.
 */
export async function fetchRepoInsights(
  token: string,
  owner: string,
  repo: string,
  defaultBranch: string
): Promise<RepoInsights> {
  const now = new Date();
  const since = new Date(now.getTime() - ACTIVITY_DAYS * 86_400_000).toISOString();

  const [metaRes, releasesRes, commitsRes] = await Promise.allSettled([
    githubFetch<RepoMeta>(`/repos/${owner}/${repo}`, token),
    githubFetch<unknown[]>(`/repos/${owner}/${repo}/releases?per_page=100`, token),
    githubFetch<CommitListItem[]>(
      `/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(
        defaultBranch
      )}&since=${since}&per_page=100`,
      token
    ),
  ]);

  const stats: RepoSocialStats = {
    stars: metaRes.status === "fulfilled" ? metaRes.value.stargazers_count : null,
    forks: metaRes.status === "fulfilled" ? metaRes.value.forks_count : null,
    watchers: metaRes.status === "fulfilled" ? metaRes.value.subscribers_count : null,
    releases:
      releasesRes.status === "fulfilled" && Array.isArray(releasesRes.value)
        ? releasesRes.value.length
        : null,
  };

  const activity = emptyActivity(now);
  const commits: InsightCommit[] = [];

  if (commitsRes.status === "fulfilled") {
    const byDay = new Map(activity.map((d) => [d.date, d]));
    for (const c of commitsRes.value) {
      const iso = c.commit?.committer?.date ?? c.commit?.author?.date;
      if (!iso) continue;
      const t = new Date(iso);
      if (Number.isNaN(t.getTime())) continue;

      const bucket = byDay.get(dayKey(t));
      if (bucket) bucket.count += 1;

      commits.push({
        sha: c.sha,
        message: c.commit.message,
        date: iso,
        author: c.commit.author?.name
          ? { name: c.commit.author.name, login: c.author?.login ?? null }
          : null,
      });
    }
  }

  return { stats, activity, commits };
}

/**
 * Combined CI verdict per commit, keyed by sha. Fans out one check-runs call
 * per sha — bounded by how many commits the page lists. A commit with no check
 * runs is left out of the map entirely so the row renders without a chip
 * rather than claiming a green build that never ran.
 */
export async function fetchCommitChecks(
  token: string,
  owner: string,
  repo: string,
  shas: string[]
): Promise<Map<string, CommitCheck>> {
  const out = new Map<string, CommitCheck>();
  if (shas.length === 0) return out;

  const results = await Promise.allSettled(
    shas.map((sha) =>
      githubFetch<CheckRunsResponse>(
        `/repos/${owner}/${repo}/commits/${sha}/check-runs`,
        token
      )
    )
  );

  results.forEach((res, i) => {
    if (res.status !== "fulfilled") return;
    const runs = res.value.check_runs ?? [];
    if (runs.length === 0) return;

    // Any still-running check keeps the whole commit pending; otherwise one
    // failure is enough to fail it. Matches how GitHub rolls the badge up.
    if (runs.some((r) => r.status !== "completed")) {
      out.set(shas[i], "pending");
      return;
    }
    const failed = runs.some(
      (r) => r.conclusion !== "success" && r.conclusion !== "neutral" && r.conclusion !== "skipped"
    );
    out.set(shas[i], failed ? "failure" : "success");
  });

  return out;
}
