import { createAdminClient } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto";

export async function getUserGithubToken(profileId: string): Promise<string | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("github_connections")
    .select("access_token")
    .eq("user_id", profileId)
    .single();
  return data?.access_token ? decryptSecret(data.access_token) : null;
}

export type UserGithubConnection = {
  token: string;
  selectedRepo: {
    owner: string;
    name: string;
    fullName: string;
    defaultBranch: string;
  } | null;
};

export async function getUserGithubConnection(
  profileId: string
): Promise<UserGithubConnection | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("github_connections")
    .select(
      "access_token, selected_repo_owner, selected_repo_name, selected_repo_full_name, selected_repo_default_branch"
    )
    .eq("user_id", profileId)
    .single();

  if (!data?.access_token) return null;

  const hasRepo = !!(
    data.selected_repo_owner &&
    data.selected_repo_name &&
    data.selected_repo_default_branch
  );

  return {
    token: decryptSecret(data.access_token),
    selectedRepo: hasRepo
      ? {
          owner: data.selected_repo_owner,
          name: data.selected_repo_name,
          fullName: data.selected_repo_full_name ?? `${data.selected_repo_owner}/${data.selected_repo_name}`,
          defaultBranch: data.selected_repo_default_branch,
        }
      : null,
  };
}
