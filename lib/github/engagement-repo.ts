import { createAdminClient } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto";

export type EngagementRepo = {
  token: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  engagementId: string | null;
  builderId: string | null;
};

type ConnectionRow = {
  access_token: string;
  selected_repo_owner: string | null;
  selected_repo_name: string | null;
  selected_repo_full_name: string | null;
  selected_repo_default_branch: string | null;
};

async function loadConnection(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<ConnectionRow | null> {
  const { data } = await supabase
    .from("github_connections")
    .select(
      "access_token, selected_repo_owner, selected_repo_name, selected_repo_full_name, selected_repo_default_branch"
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (!data?.access_token) return null;
  return data as ConnectionRow;
}

function defaultRepoFrom(conn: ConnectionRow): {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
} | null {
  if (
    !conn.selected_repo_owner ||
    !conn.selected_repo_name ||
    !conn.selected_repo_default_branch
  ) {
    return null;
  }
  return {
    owner: conn.selected_repo_owner,
    name: conn.selected_repo_name,
    fullName:
      conn.selected_repo_full_name ??
      `${conn.selected_repo_owner}/${conn.selected_repo_name}`,
    defaultBranch: conn.selected_repo_default_branch,
  };
}

type EngagementRow = {
  id: string;
  builder_id: string;
  operator_id: string | null;
  github_repo_owner: string | null;
  github_repo_name: string | null;
  github_repo_full_name: string | null;
  github_default_branch: string | null;
};

async function resolveFromEngagement(
  engagement: EngagementRow | null,
  currentProfileId: string
): Promise<EngagementRepo | null> {
  // Authorization gate: when this resolves an actual engagement, the caller must
  // be a member of it (builder or operator). Without this, any authenticated user
  // could pass another engagement's task/engagement id and read its commits —
  // and the builder-token fallback below would even fetch them with the builder's
  // token (confused deputy). The fallback is safe only because we gate here first.
  if (
    engagement &&
    currentProfileId !== engagement.builder_id &&
    currentProfileId !== engagement.operator_id
  ) {
    return null;
  }

  const supabase = createAdminClient();

  const currentConn = await loadConnection(supabase, currentProfileId);
  const builderConn =
    engagement?.builder_id && engagement.builder_id !== currentProfileId
      ? await loadConnection(supabase, engagement.builder_id)
      : null;

  const conn = currentConn ?? builderConn;
  if (!conn) return null;

  const engagementRepo =
    engagement &&
    engagement.github_repo_owner &&
    engagement.github_repo_name &&
    engagement.github_default_branch
      ? {
          owner: engagement.github_repo_owner,
          name: engagement.github_repo_name,
          fullName:
            engagement.github_repo_full_name ??
            `${engagement.github_repo_owner}/${engagement.github_repo_name}`,
          defaultBranch: engagement.github_default_branch,
        }
      : null;

  const repo =
    engagementRepo ??
    (currentConn ? defaultRepoFrom(currentConn) : null) ??
    (builderConn ? defaultRepoFrom(builderConn) : null);

  if (!repo) return null;

  return {
    token: decryptSecret(conn.access_token),
    owner: repo.owner,
    name: repo.name,
    fullName: repo.fullName,
    defaultBranch: repo.defaultBranch,
    engagementId: engagement?.id ?? null,
    builderId: engagement?.builder_id ?? null,
  };
}

/**
 * Resolves a usable (token, repo) pair for a task.
 *
 * Lookup order:
 *   1. Current user's GitHub token (the actor calling the API).
 *      Falls back to the engagement's builder token if the current user
 *      has no GitHub connection.
 *   2. Repo coords: engagement-level repo → current user's default repo →
 *      engagement-builder's default repo.
 *
 * Returns null only when no token at all is available, or no repo is selected
 * anywhere.
 */
export async function getEngagementRepoForTask(
  taskId: string,
  currentProfileId: string
): Promise<EngagementRepo | null> {
  const supabase = createAdminClient();

  const { data: task } = await supabase
    .from("tasks")
    .select("engagement_id")
    .eq("id", taskId)
    .maybeSingle();
  if (!task) return null;

  const { data: engagement } = task.engagement_id
    ? await supabase
        .from("engagements")
        .select(
          "id, builder_id, operator_id, github_repo_owner, github_repo_name, github_repo_full_name, github_default_branch"
        )
        .eq("id", task.engagement_id)
        .maybeSingle<EngagementRow>()
    : { data: null };

  return resolveFromEngagement(engagement ?? null, currentProfileId);
}

/**
 * Same as getEngagementRepoForTask but starts from an engagement id directly.
 * Used by views (like the operator project profile) that already know which
 * engagement they're rendering.
 */
export async function getEngagementRepoById(
  engagementId: string,
  currentProfileId: string
): Promise<EngagementRepo | null> {
  const supabase = createAdminClient();

  const { data: engagement } = await supabase
    .from("engagements")
    .select(
      "id, builder_id, github_repo_owner, github_repo_name, github_repo_full_name, github_default_branch"
    )
    .eq("id", engagementId)
    .maybeSingle<EngagementRow>();

  return resolveFromEngagement(engagement ?? null, currentProfileId);
}
