import type { GitHubRepo } from "@/lib/types"

// Lists the repos the connected GitHub account can link (owner or collaborator).
export async function fetchGithubRepos(token: string): Promise<GitHubRepo[]> {
  try {
    const res = await fetch(
      "https://api.github.com/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
        cache: "no-store",
      }
    )
    if (!res.ok) return []
    const data = (await res.json()) as GitHubRepo[]
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}
