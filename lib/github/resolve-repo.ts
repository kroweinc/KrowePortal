import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { buildRepoContext } from "./repo-context";
import { getUserGithubConnection } from "./token";
import type { RepoContext } from "./types";
import type { RepoToolContext } from "./ai-tools";

export type RepoSource = "engagement" | "user_selected";

export type ResolvedRepo = {
  repoContext: RepoContext | null;
  toolContext: RepoToolContext | undefined;
  source: RepoSource | null;
};

type EngagementRepoRow = {
  github_repo_owner: string | null;
  github_repo_name: string | null;
  github_default_branch: string | null;
};

async function fetchEngagementRepo(
  engagementId: string
): Promise<{ owner: string; name: string; defaultBranch: string } | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("engagements")
    .select("github_repo_owner, github_repo_name, github_default_branch")
    .eq("id", engagementId)
    .single<EngagementRepoRow>();

  if (!data?.github_repo_owner || !data?.github_repo_name || !data?.github_default_branch) {
    return null;
  }
  return {
    owner: data.github_repo_owner,
    name: data.github_repo_name,
    defaultBranch: data.github_default_branch,
  };
}

export async function resolveRepoForGeneration(opts: {
  profileId: string;
  engagementId?: string | null;
  logPrefix?: string;
}): Promise<ResolvedRepo> {
  const log = opts.logPrefix ?? "[resolveRepoForGeneration]";

  const connection = await getUserGithubConnection(opts.profileId);
  if (!connection) {
    console.log(`${log} no GitHub connection for profile`);
    return { repoContext: null, toolContext: undefined, source: null };
  }

  let coords: { owner: string; name: string; defaultBranch: string } | null = null;
  let source: RepoSource | null = null;

  if (opts.engagementId) {
    const engagementRepo = await fetchEngagementRepo(opts.engagementId);
    if (engagementRepo) {
      coords = engagementRepo;
      source = "engagement";
    }
  }

  if (!coords && connection.selectedRepo) {
    coords = {
      owner: connection.selectedRepo.owner,
      name: connection.selectedRepo.name,
      defaultBranch: connection.selectedRepo.defaultBranch,
    };
    source = "user_selected";
  }

  if (!coords) {
    console.log(`${log} no repo coords (engagement has none, user hasn't selected one)`);
    return { repoContext: null, toolContext: undefined, source: null };
  }

  try {
    const repoContext = await buildRepoContext(
      connection.token,
      coords.owner,
      coords.name,
      coords.defaultBranch
    );

    if (!repoContext) {
      console.log(`${log} buildRepoContext returned null for ${coords.owner}/${coords.name}`);
      return { repoContext: null, toolContext: undefined, source };
    }

    return {
      repoContext,
      toolContext: {
        token: connection.token,
        owner: coords.owner,
        repo: coords.name,
        ref: coords.defaultBranch,
      },
      source,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`${log} buildRepoContext threw for ${coords.owner}/${coords.name}:`, msg);
    return { repoContext: null, toolContext: undefined, source };
  }
}
