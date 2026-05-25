import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import {
  generateProjectProfile,
  type ProjectProfile,
} from "@/lib/ai/generate-project-profile";
import type { RepoContext } from "@/lib/github/types";
import type { RepoToolContext } from "@/lib/github/ai-tools";

export type { ProjectProfile };

type ProjectProfileRow = {
  summary: string;
  audience: string;
  features: unknown;
  current_state: string;
  state_rationale: string;
  services: unknown;
};

function rowToProfile(row: ProjectProfileRow): ProjectProfile {
  return {
    summary: row.summary,
    audience: row.audience,
    features: Array.isArray(row.features) ? (row.features as string[]) : [],
    currentState: row.current_state as ProjectProfile["currentState"],
    stateRationale: row.state_rationale,
    services: Array.isArray(row.services)
      ? (row.services as ProjectProfile["services"])
      : [],
  };
}

async function readCachedProfile(
  repoFullName: string,
  commitSha: string
): Promise<ProjectProfile | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("project_profiles")
    .select("summary, audience, features, current_state, state_rationale, services")
    .eq("repo_full_name", repoFullName)
    .eq("commit_sha", commitSha)
    .maybeSingle<ProjectProfileRow>();

  if (error) {
    console.error("[getProjectProfile] read failed", {
      repo: repoFullName,
      sha: commitSha,
      error: error.message,
    });
    return null;
  }
  return data ? rowToProfile(data) : null;
}

async function persistProfile(
  repoFullName: string,
  commitSha: string,
  ctx: RepoContext,
  result: Awaited<ReturnType<typeof generateProjectProfile>>
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("project_profiles").upsert(
    {
      repo_full_name: repoFullName,
      commit_sha: commitSha,
      summary: result.profile.summary,
      audience: result.profile.audience,
      features: result.profile.features,
      current_state: result.profile.currentState,
      state_rationale: result.profile.stateRationale,
      services: result.profile.services,
      model: result.model,
      tool_rounds: result.telemetry.rounds,
      tool_calls: result.telemetry.toolCalls,
      files_read: result.telemetry.filesRead,
      total_bytes: result.telemetry.totalBytes,
      hit_max_rounds: result.telemetry.hitMaxRounds,
      degraded: ctx.degraded.length > 0 ? ctx.degraded : null,
    },
    { onConflict: "repo_full_name,commit_sha" }
  );

  if (error) {
    console.error("[getProjectProfile] persist failed", {
      repo: repoFullName,
      sha: commitSha,
      error: error.message,
    });
  }
}

export type GetProjectProfileOptions = {
  forceRefresh?: boolean;
};

export async function getProjectProfile(
  ctx: RepoContext,
  toolContext: RepoToolContext,
  options: GetProjectProfileOptions = {}
): Promise<ProjectProfile | null> {
  const repoFullName = ctx.fullName;
  const commitSha = ctx.recentCommits[0]?.sha ?? "no-commits";

  if (!options.forceRefresh) {
    const cached = await readCachedProfile(repoFullName, commitSha);
    if (cached) return cached;
  }

  try {
    const result = await generateProjectProfile(ctx, toolContext);
    await persistProfile(repoFullName, commitSha, ctx, result);
    return result.profile;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[getProjectProfile] generation failed", {
      repo: repoFullName,
      error: msg,
    });
    return null;
  }
}

export async function invalidateProjectProfile(
  repoFullName: string,
  commitSha: string
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("project_profiles")
    .delete()
    .eq("repo_full_name", repoFullName)
    .eq("commit_sha", commitSha);

  if (error) {
    console.error("[invalidateProjectProfile] delete failed", {
      repo: repoFullName,
      sha: commitSha,
      error: error.message,
    });
  }
}
