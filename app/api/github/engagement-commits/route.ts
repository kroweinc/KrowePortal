import { NextRequest, NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { getEngagementRepoForTask } from "@/lib/github/engagement-repo";
import { githubFetch } from "@/lib/github/client";
import { AuthError, RateLimitError, NotFoundError } from "@/lib/github/types";

type GhCommit = {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { name?: string | null; date?: string | null } | null;
  };
  author: { login?: string | null } | null;
};

export type EngagementCommit = {
  sha: string;
  short_sha: string;
  message: string;
  html_url: string;
  author_name: string | null;
  author_login: string | null;
  committed_at: string | null;
  repo_full_name: string;
};

export async function GET(request: NextRequest) {
  const taskId = request.nextUrl.searchParams.get("taskId");
  const q = request.nextUrl.searchParams.get("q")?.trim().toLowerCase() ?? "";
  if (!taskId) {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const repo = await getEngagementRepoForTask(taskId, profile.id);
  if (!repo) {
    return NextResponse.json(
      {
        error: "no_repo",
        message:
          "No GitHub repo available. Connect GitHub and select a default repo (or set a repo on this client) in settings.",
      },
      { status: 412 }
    );
  }

  try {
    const path = `/repos/${repo.owner}/${repo.name}/commits?per_page=20&sha=${encodeURIComponent(repo.defaultBranch)}`;
    const raw = await githubFetch<GhCommit[]>(path, repo.token);

    const mapped: EngagementCommit[] = raw.map((c) => {
      const message = c.commit?.message ?? "";
      return {
        sha: c.sha,
        short_sha: c.sha.slice(0, 7),
        message,
        html_url: c.html_url,
        author_name: c.commit?.author?.name ?? null,
        author_login: c.author?.login ?? null,
        committed_at: c.commit?.author?.date ?? null,
        repo_full_name: repo.fullName,
      };
    });

    const filtered = q
      ? mapped.filter(
          (m) =>
            m.sha.toLowerCase().includes(q) ||
            m.short_sha.toLowerCase().includes(q) ||
            m.message.toLowerCase().includes(q)
        )
      : mapped;

    return NextResponse.json({ repo: repo.fullName, commits: filtered });
  } catch (e: unknown) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: "github_auth" }, { status: 401 });
    }
    if (e instanceof RateLimitError) {
      return NextResponse.json({ error: "github_ratelimit" }, { status: 429 });
    }
    if (e instanceof NotFoundError) {
      return NextResponse.json({ error: "github_not_found" }, { status: 404 });
    }
    const message = e instanceof Error ? e.message : "GitHub request failed";
    return NextResponse.json({ error: "github_error", message }, { status: 502 });
  }
}
