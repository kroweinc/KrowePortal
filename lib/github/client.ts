import { GitHubError, RateLimitError, AuthError, NotFoundError } from "./types";

const GH_BASE = "https://api.github.com";

export async function githubFetch<T = unknown>(
  path: string,
  token: string
): Promise<T> {
  const res = await fetch(`${GH_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!res.ok) {
    const remaining = res.headers.get("X-RateLimit-Remaining");
    if (res.status === 403 && remaining === "0") throw new RateLimitError();
    if (res.status === 401) throw new AuthError();
    if (res.status === 404) throw new NotFoundError(path);
    throw new GitHubError(`GitHub API error on ${path}: ${res.status}`, res.status);
  }

  return res.json() as Promise<T>;
}
