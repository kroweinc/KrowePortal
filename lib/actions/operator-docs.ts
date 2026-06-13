"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import type { Quote, Contract, Prd, Engagement } from "@/lib/types";

export interface OperatorSignedDocs {
  quote: Quote | null;
  contract: Contract | null;
  prd: Prd | null;
}

/**
 * The signed Quote / Contract / PRD an operator should see for their
 * engagement, read from the new project-scoped document tables. Those tables
 * are RLS-restricted to the project's builder, so the operator reads them
 * through the admin client after we verify they own the engagement.
 */
export async function getSignedDocsForEngagement(
  engagement: Pick<Engagement, "id" | "project_id" | "operator_id">
): Promise<OperatorSignedDocs> {
  const empty: OperatorSignedDocs = { quote: null, contract: null, prd: null };

  const profile = await getCurrentProfile();
  if (!profile) return empty;

  // Authorize: must be the engagement's operator (dev profiles bypass).
  const isDev = DEV_PROFILE_IDS.has(profile.id);
  if (!isDev && engagement.operator_id !== profile.id) return empty;
  if (!engagement.project_id) return empty;

  const admin = createAdminClient();
  const projectId = engagement.project_id;

  const [quoteRes, contractRes, prdRes] = await Promise.all([
    admin
      .from("quotes")
      .select("*")
      .eq("project_id", projectId)
      .in("status", ["signed", "accepted"])
      .order("signed_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("contracts")
      .select("*")
      .eq("project_id", projectId)
      .eq("status", "signed")
      .order("signed_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("prds")
      .select("*")
      .eq("project_id", projectId)
      .eq("status", "signed")
      .order("signed_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    quote: (quoteRes.data ?? null) as Quote | null,
    contract: (contractRes.data ?? null) as Contract | null,
    prd: (prdRes.data ?? null) as Prd | null,
  };
}
