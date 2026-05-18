import { createAdminClient } from "@/lib/supabase/server";

/**
 * Returns the token if it maps to a currently-pending, non-expired invitation;
 * null otherwise. Uses the admin client so RLS doesn't block pre-profile users.
 */
export async function validatePendingInvite(token: string | undefined): Promise<string | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("invitations")
    .select("status, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (!data) return null;
  if (data.status !== "pending") return null;
  if (new Date(data.expires_at) < new Date()) return null;

  return token;
}
