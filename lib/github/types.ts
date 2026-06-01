export type RepoContext = {
  fullName: string;
  owner: string;
  repo: string;
  defaultBranch: string;
  description: string | null;
  readmeExcerpt: string;
  topLevelTree: string[];
  fileManifest: string[];
  manifestTruncated: boolean;
  languages: { name: string; pct: number }[];
  recentCommits: {
    sha: string;
    message: string;
    date: string;
    author: { name: string; login: string | null } | null;
  }[];
  degraded: string[];
};

export class GitHubError extends Error {
  constructor(msg: string, public status: number) {
    super(msg);
    this.name = "GitHubError";
  }
}
export class RateLimitError extends GitHubError {
  constructor() { super("GitHub rate limit exceeded", 403); this.name = "RateLimitError"; }
}
export class AuthError extends GitHubError {
  constructor() { super("GitHub token invalid or expired", 401); this.name = "AuthError"; }
}
export class NotFoundError extends GitHubError {
  constructor(resource: string) { super(`GitHub resource not found: ${resource}`, 404); this.name = "NotFoundError"; }
}
