"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : await createClient();
}

// Removes the user's stored GitHub connection. Reconnecting is a fresh OAuth
// round-trip (the callback upserts on user_id), so this is a clean reset for a
// wrong account or an expired/revoked token.
export async function disconnectGithub(): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not authenticated." };

  const supabase = await getClient(profile.id);
  const { error } = await supabase
    .from("github_connections")
    .delete()
    .eq("user_id", profile.id);
  if (error) return { error: error.message };

  revalidatePath("/b/github");
  revalidatePath("/b/settings/github");
  return { success: true };
}
