"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import type { Engagement } from "@/lib/types";

export type OperatorBuilderBasics = {
  name: string;
  avatarUrl: string | null;
  headline: string | null;
  bio: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
  /** Capability token when the builder has published their profile. */
  profileToken: string | null;
};

/**
 * Basic builder identity for an operator's engagement. builder_profiles is
 * owner-only under RLS, so the operator reads it through the admin client
 * after we verify engagement membership — same pattern as operator-contact.ts.
 */
export async function getBuilderBasicsForEngagement(
  engagement: Pick<Engagement, "id" | "builder_id" | "operator_id">
): Promise<OperatorBuilderBasics | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const isDev = DEV_PROFILE_IDS.has(profile.id);
  if (!isDev && engagement.operator_id !== profile.id) return null;
  if (!engagement.builder_id) return null;

  const admin = createAdminClient();

  const { data: account } = await admin
    .from("profiles")
    .select("display_name")
    .eq("id", engagement.builder_id)
    .maybeSingle();

  const fallbackName = account?.display_name ?? "Your builder";

  const { data } = await admin
    .from("builder_profiles")
    .select(
      "display_name, headline, bio, linkedin_url, github_url, portfolio_url, avatar_storage_path, is_published, token"
    )
    .eq("user_id", engagement.builder_id)
    .maybeSingle();

  if (!data) {
    return {
      name: fallbackName,
      avatarUrl: null,
      headline: null,
      bio: null,
      linkedinUrl: null,
      githubUrl: null,
      portfolioUrl: null,
      profileToken: null,
    };
  }

  let avatarUrl: string | null = null;
  if (data.avatar_storage_path) {
    const { data: signed } = await admin.storage
      .from("avatars")
      .createSignedUrl(data.avatar_storage_path, 60 * 60 * 24);
    avatarUrl = signed?.signedUrl ?? null;
  }

  return {
    name: data.display_name || fallbackName,
    avatarUrl,
    headline: data.headline,
    bio: data.bio,
    linkedinUrl: data.linkedin_url,
    githubUrl: data.github_url,
    portfolioUrl: data.portfolio_url,
    profileToken: data.is_published ? data.token : null,
  };
}
