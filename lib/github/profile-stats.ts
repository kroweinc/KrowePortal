import { githubFetch } from "./client";
import type { RepoLanguage } from "@/lib/types";

export interface RepoShowcaseStats {
  description: string | null;
  languages: RepoLanguage[];
  commitCount: number | null;
  stars: number | null;
  pushedAt: string | null;
  isPrivate: boolean;
  degraded: string[];
}

interface RepoMeta {
  description: string | null;
  stargazers_count: number;
  pushed_at: string | null;
  private: boolean;
}

interface Contributor {
  login: string;
  contributions: number;
}

// Fetch the showcase snapshot for one repo: metadata, language split, and the
// builder's own commit count. Commit count comes from /contributors (one call,
// default branch); if the user isn't in the first 100 contributors we fall back
// to the commit search API, and failing that store null so the UI omits the
// stat instead of showing 0. RateLimitError/AuthError propagate to the caller
// when every sub-fetch fails with one.
export async function fetchRepoShowcaseStats(
  token: string,
  fullName: string,
  githubUsername: string
): Promise<RepoShowcaseStats | null> {
  const degraded: string[] = [];

  const results = await Promise.allSettled([
    githubFetch<RepoMeta>(`/repos/${fullName}`, token),
    githubFetch<Record<string, number>>(`/repos/${fullName}/languages`, token),
    githubFetch<Contributor[]>(`/repos/${fullName}/contributors?per_page=100`, token),
  ]);

  if (results.every((r) => r.status === "rejected")) {
    // Surface auth/rate-limit failures so the sync loop can abort cleanly.
    throw (results[0] as PromiseRejectedResult).reason;
  }

  let description: string | null = null;
  let stars: number | null = null;
  let pushedAt: string | null = null;
  let isPrivate = false;
  if (results[0].status === "fulfilled") {
    description = results[0].value.description;
    stars = results[0].value.stargazers_count;
    pushedAt = results[0].value.pushed_at;
    isPrivate = results[0].value.private;
  } else {
    degraded.push("repo");
  }

  let languages: RepoLanguage[] = [];
  if (results[1].status === "fulfilled") {
    const raw = results[1].value;
    const total = Object.values(raw).reduce((a, b) => a + b, 0);
    if (total > 0) {
      languages = Object.entries(raw)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, bytes]) => ({ name, pct: Math.round((bytes / total) * 100) }));
    }
  } else {
    degraded.push("languages");
  }

  let commitCount: number | null = null;
  if (results[2].status === "fulfilled") {
    const me = results[2].value.find(
      (c) => c.login?.toLowerCase() === githubUsername.toLowerCase()
    );
    if (me) {
      commitCount = me.contributions;
    } else {
      commitCount = await searchCommitCount(token, fullName, githubUsername);
      if (commitCount === null) degraded.push("commits");
    }
  } else {
    degraded.push("commits");
  }

  return { description, languages, commitCount, stars, pushedAt, isPrivate, degraded };
}

// Fallback when the user isn't in the first 100 contributors. The commit
// search API has its own tight rate budget, so this is best-effort only.
async function searchCommitCount(
  token: string,
  fullName: string,
  githubUsername: string
): Promise<number | null> {
  try {
    const result = await githubFetch<{ total_count: number }>(
      `/search/commits?q=${encodeURIComponent(`repo:${fullName} author:${githubUsername}`)}&per_page=1`,
      token
    );
    return result.total_count;
  } catch {
    return null;
  }
}
