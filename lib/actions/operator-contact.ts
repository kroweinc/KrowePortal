"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import type { Project, Engagement } from "@/lib/types";

export type BusinessContact = Pick<
  Project,
  "prospect_name" | "prospect_email" | "website_url" | "linkedin_url" | "live_url" | "context"
> & { projectName: string };

/**
 * The business contact for an operator's engagement, read from the linked
 * project. The projects table is RLS-restricted to the project's builder
 * (owner_id = auth.uid()), so the operator reads it through the admin client
 * after we verify they own the engagement — the same pattern as
 * getSignedDocsForEngagement in operator-docs.ts.
 */
export async function getBusinessContactForEngagement(
  engagement: Pick<Engagement, "id" | "project_id" | "operator_id">
): Promise<BusinessContact | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  // Authorize: must be the engagement's operator (dev profiles bypass).
  const isDev = DEV_PROFILE_IDS.has(profile.id);
  if (!isDev && engagement.operator_id !== profile.id) return null;
  if (!engagement.project_id) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("projects")
    .select("name, prospect_name, prospect_email, website_url, linkedin_url, live_url, context")
    .eq("id", engagement.project_id)
    .maybeSingle();

  if (!data) return null;

  return {
    projectName: data.name,
    prospect_name: data.prospect_name,
    prospect_email: data.prospect_email,
    website_url: data.website_url,
    linkedin_url: data.linkedin_url,
    live_url: data.live_url,
    context: data.context,
  };
}
