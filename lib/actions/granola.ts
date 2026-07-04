"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { getClient } from "@/lib/granola/draft-core";

// Connecting happens via OAuth in app/api/granola/{connect,callback} — these
// actions only read status and disconnect.

export interface GranolaConnectionStatus {
  connected: boolean;
  connectedAt: string | null;
  granolaEmail: string | null;
  /** Access token expired and no refresh token — user must re-run OAuth. */
  needsReconnect: boolean;
}

/** Connection metadata only — tokens never leave the server. */
export async function getGranolaConnectionStatus(): Promise<GranolaConnectionStatus> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  // Read via the admin client: the token columns are excluded from the
  // authenticated role's column grants (0068), and this only ever returns
  // metadata + a refresh-token presence boolean for the caller's own row.
  const { data } = await createAdminClient()
    .from("granola_connections")
    .select("connected_at, granola_email, token_expires_at, refresh_token")
    .eq("user_id", profile.id)
    .maybeSingle();

  const expiresAt = data?.token_expires_at ? Date.parse(data.token_expires_at) : 0;
  return {
    connected: !!data,
    connectedAt: data?.connected_at ?? null,
    granolaEmail: data?.granola_email ?? null,
    needsReconnect: !!data && !data.refresh_token && expiresAt <= Date.now(),
  };
}

/** Removes the connection. Already-imported transcripts and tasks stay.
    Granola's auth server advertises no revocation endpoint, so deleting the
    encrypted tokens is the whole disconnect. */
export async function disconnectGranola(): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders can manage Granola." };

  const supabase = await getClient(profile.id);
  const { error } = await supabase
    .from("granola_connections")
    .delete()
    .eq("user_id", profile.id);
  if (error) return { error: error.message };

  revalidatePath("/b/settings/granola");
  return { success: true };
}
