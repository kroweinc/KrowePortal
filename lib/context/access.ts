import "server-only";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { DEV_PROFILE_IDS } from "@/lib/auth";

// Shared access helpers for the Client Context Layer, used by the ingestion
// actions (context.ts), search (context-search.ts), and the assembly seam
// (buildClientContext.ts).

/**
 * Dev builder/operator ids have no real auth session, so their work routes
 * through the service-role admin client (which BYPASSES RLS). Every caller must
 * therefore still authorize explicitly via assertEngagementBuilder — RLS alone
 * is not a guarantee on the dev path.
 */
export async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : await createClient();
}

/**
 * True iff the given profile is the builder who owns the engagement. Reads via
 * the admin client so the check is correct under both the RLS and dev-admin
 * paths (mirrors how app/b/engagements/[id]/page.tsx resolves ownership).
 */
export async function assertEngagementBuilder(
  engagementId: string,
  profileId: string
): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("engagements")
    .select("builder_id")
    .eq("id", engagementId)
    .maybeSingle();
  return !!data && data.builder_id === profileId;
}
