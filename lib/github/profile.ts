import { githubFetch } from "./client";

export interface GithubProfile {
  login: string;
  name: string | null;
  avatarUrl: string;
  htmlUrl: string;
  bio: string | null;
  publicRepos: number;
  followers: number;
}

interface RawGithubUser {
  login: string;
  name: string | null;
  avatar_url: string;
  html_url: string;
  bio: string | null;
  public_repos: number;
  followers: number;
}

// Fetch the authenticated user's GitHub profile (/user). Returns null on any
// failure so the settings page can degrade to showing just the username.
export async function fetchGithubProfile(token: string): Promise<GithubProfile | null> {
  try {
    const u = await githubFetch<RawGithubUser>("/user", token);
    return {
      login: u.login,
      name: u.name,
      avatarUrl: u.avatar_url,
      htmlUrl: u.html_url,
      bio: u.bio,
      publicRepos: u.public_repos,
      followers: u.followers,
    };
  } catch {
    return null;
  }
}
