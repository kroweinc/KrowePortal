import { createAdminClient } from "@/lib/supabase/server";

export async function getUserGithubToken(profileId: string): Promise<string | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("github_connections")
    .select("access_token")
    .eq("user_id", profileId)
    .single();
  return data?.access_token ?? null;
}
