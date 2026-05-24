import { unstable_cache } from "next/cache";
import { githubFetch } from "./client";
import type { RepoContext } from "./types";

const MANIFEST_CAP = 2000;

const NOISE_PATH_PREFIXES = [
  "node_modules/",
  ".next/",
  ".nuxt/",
  "dist/",
  "build/",
  "out/",
  "coverage/",
  ".turbo/",
  ".cache/",
  ".vercel/",
  ".git/",
  ".idea/",
  ".vscode/",
];

const NOISE_PATH_SUBSTRINGS = [
  "/node_modules/",
  "/dist/",
  "/build/",
  "/.next/",
];

const NOISE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "tiff",
  "svg",
  "woff", "woff2", "ttf", "otf", "eot",
  "pdf", "zip", "tar", "gz", "tgz", "rar", "7z",
  "mp3", "mp4", "wav", "ogg", "webm", "mov", "avi",
  "exe", "dll", "so", "dylib",
  "lock",
  "min.js", "min.css",
  "map",
]);

const NOISE_FILENAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "Gemfile.lock",
  "Cargo.lock",
  "poetry.lock",
  "uv.lock",
  "composer.lock",
]);

function isNoisePath(path: string): boolean {
  for (const prefix of NOISE_PATH_PREFIXES) {
    if (path.startsWith(prefix)) return true;
  }
  for (const sub of NOISE_PATH_SUBSTRINGS) {
    if (path.includes(sub)) return true;
  }
  const base = path.split("/").pop() ?? path;
  if (NOISE_FILENAMES.has(base)) return true;
  const lower = base.toLowerCase();
  for (const ext of NOISE_EXTENSIONS) {
    if (lower.endsWith("." + ext)) return true;
  }
  return false;
}

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
    githubFetch<{ tree: { path: string; type: string }[]; truncated: boolean }>(
      `/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`,
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
  let fileManifest: string[] = [];
  let manifestTruncated = false;
  if (results[2].status === "fulfilled") {
    const tree = results[2].value.tree;
    const apiTruncated = results[2].value.truncated === true;

    const filtered = tree.filter((item) => !isNoisePath(item.path));

    const topLevelSet = new Set<string>();
    for (const item of filtered) {
      const firstSeg = item.path.split("/")[0];
      if (item.type === "tree" && !item.path.includes("/")) {
        topLevelSet.add(`${firstSeg}/`);
      } else if (item.type === "blob" && !item.path.includes("/")) {
        topLevelSet.add(firstSeg);
      } else if (item.path.includes("/")) {
        topLevelSet.add(`${firstSeg}/`);
      }
    }
    topLevelTree = Array.from(topLevelSet).sort().slice(0, 60);

    const blobs = filtered
      .filter((item) => item.type === "blob")
      .map((item) => item.path);

    if (blobs.length > MANIFEST_CAP) {
      manifestTruncated = true;
      fileManifest = blobs.slice(0, MANIFEST_CAP);
    } else {
      fileManifest = blobs;
    }

    if (apiTruncated) {
      manifestTruncated = true;
    }
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
    owner,
    repo,
    defaultBranch,
    description,
    readmeExcerpt,
    topLevelTree,
    fileManifest,
    manifestTruncated,
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
