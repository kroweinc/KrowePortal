import { unstable_cache } from "next/cache";
import { githubFetch } from "./client";
import type { RepoContext } from "./types";

async function fetchRepoContext(
  token: string,
  owner: string,
  repo: string,
  defaultBranch: string
): Promise<RepoContext | null> {
  const degraded: string[] = [];

  const results = await Promise.allSettled([
    githubFetch<{ description: string | null }>(`/repos/${owner}/${repo}`, token),
    githubFetch<{ content: string }>(`/repos/${owner}/${repo}/readme`, token),
    githubFetch<{ tree: { path: string; type: string }[] }>(
      `/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=0`,
      token
    ),
    githubFetch<Record<string, number>>(`/repos/${owner}/${repo}/languages`, token),
    githubFetch<{ sha: string; commit: { message: string; author: { date: string } } }[]>(
      `/repos/${owner}/${repo}/commits?per_page=8`,
      token
    ),
  ]);

  const allFailed = results.every((r) => r.status === "rejected");
  if (allFailed) return null;

  let description: string | null = null;
  if (results[0].status === "fulfilled") {
    description = results[0].value.description;
  } else {
    degraded.push("repo");
  }

  let readmeExcerpt = "";
  if (results[1].status === "fulfilled") {
    try {
      const decoded = Buffer.from(results[1].value.content, "base64").toString("utf-8");
      readmeExcerpt = decoded.length > 4000 ? decoded.slice(0, 4000) + "\n…[truncated]" : decoded;
    } catch {
      degraded.push("readme");
    }
  } else {
    degraded.push("readme");
  }

  let topLevelTree: string[] = [];
  if (results[2].status === "fulfilled") {
    topLevelTree = results[2].value.tree
      .slice(0, 60)
      .map((item) => (item.type === "tree" ? `${item.path}/` : item.path));
  } else {
    degraded.push("tree");
  }

  let languages: { name: string; pct: number }[] = [];
  if (results[3].status === "fulfilled") {
    const raw = results[3].value;
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

  let recentCommits: { sha: string; message: string; date: string }[] = [];
  if (results[4].status === "fulfilled") {
    recentCommits = results[4].value.map((c) => ({
      sha: c.sha.slice(0, 7),
      message: c.commit.message.split("\n")[0].slice(0, 120),
      date: c.commit.author.date,
    }));
  } else {
    degraded.push("commits");
  }

  return {
    fullName: `${owner}/${repo}`,
    defaultBranch,
    description,
    readmeExcerpt,
    topLevelTree,
    languages,
    recentCommits,
    degraded,
  };
}

export const buildRepoContext = unstable_cache(
  fetchRepoContext,
  ["repo-context"],
  { revalidate: 600 }
);
