"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import type {
  BuilderProfileCodingTool,
  BuilderProfileExperience,
  BuilderProfileProject,
} from "@/lib/types";

const TOKEN_RE = /^[a-f0-9]{64}$/;

// Builder-added badges, capped so a rich profile can't produce an unbounded
// badge row.
const MAX_DISPLAY_TAGS = 14;

export interface PublicBuilderProfile {
  displayName: string;
  headline: string | null;
  bio: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
  educationSchool: string | null;
  educationMajor: string | null;
  educationYear: string | null;
  tags: string[];
  avatarUrl: string | null;
  hasResume: boolean;
  githubUsername: string | null;
  githubSyncedAt: string | null;
  projects: BuilderProfileProject[];
  experience: BuilderProfileExperience[];
  codingTools: BuilderProfileCodingTool[];
}

// Public, no-auth lookup of a builder profile by token. Admin client + token
// is the capability (see contracts-public). Unpublished profiles are never
// exposed, and the storage path never leaves the server.
export async function getBuilderProfileByToken(
  token: string
): Promise<PublicBuilderProfile | null> {
  if (!TOKEN_RE.test(token)) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("builder_profiles")
    .select("*, owner:profiles!user_id(display_name)")
    .eq("token", token)
    .maybeSingle();

  if (!data || !data.is_published) return null;
  // Reject revoked or expired share links (see migration 0062).
  if (data.token_revoked_at) return null;
  if (data.token_expires_at && new Date(data.token_expires_at as string) < new Date()) return null;

  return assemblePublicProfile(admin, data);
}

// Builder-only preview of their own profile, published or not. Returns the
// exact PublicBuilderProfile shape the live /p/[token] page receives so the
// preview can never drift from the real thing.
export async function getOwnProfilePreview(): Promise<{
  profile: PublicBuilderProfile;
  token: string;
} | null> {
  const current = await getCurrentProfile();
  if (!current || current.role !== "builder") return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("builder_profiles")
    .select("*, owner:profiles!user_id(display_name)")
    .eq("user_id", current.id)
    .maybeSingle();

  if (!data) return null;

  const profile = await assemblePublicProfile(admin, data);
  // Dev auth profiles may have no profiles row to join against.
  if (profile.displayName === "Builder" && current.display_name) {
    profile.displayName = current.display_name;
  }
  return { profile, token: data.token };
}

// Shared between the token lookup and the owner preview — both must produce
// byte-identical data shapes. Not exported: callers can never sign arbitrary
// storage paths, and this never becomes a POST endpoint.
async function assemblePublicProfile(
  admin: ReturnType<typeof createAdminClient>,
  data: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<PublicBuilderProfile> {
  const [{ data: projects }, { data: experience }, { data: codingTools }, { data: connection }] =
    await Promise.all([
      admin
        .from("builder_profile_projects")
        .select("*")
        .eq("builder_profile_id", data.id)
        .order("display_order", { ascending: true }),
      admin
        .from("builder_profile_experience")
        .select("*")
        .eq("builder_profile_id", data.id)
        .order("display_order", { ascending: true }),
      admin
        .from("builder_profile_coding_tools")
        .select("*")
        .eq("builder_profile_id", data.id)
        .order("display_order", { ascending: true }),
      admin
        .from("github_connections")
        .select("github_username")
        .eq("user_id", data.user_id)
        .maybeSingle(),
    ]);

  // Signed inline (not via an exported helper) so callers can never sign
  // arbitrary storage paths. 24h TTL outlives any cached render.
  let avatarUrl: string | null = null;
  if (data.avatar_storage_path) {
    const { data: signed } = await admin.storage
      .from("avatars")
      .createSignedUrl(data.avatar_storage_path, 60 * 60 * 24);
    avatarUrl = signed?.signedUrl ?? null;
  }

  const projectList = (projects ?? []) as BuilderProfileProject[];
  const experienceList = (experience ?? []) as BuilderProfileExperience[];
  const codingToolList = (codingTools ?? []) as BuilderProfileCodingTool[];

  // Show only the badges the builder has added. Derived badges are surfaced as
  // recommendations in the editor; they appear here only once the builder adds them.
  const tags = ((data.tags ?? []) as string[]).slice(0, MAX_DISPLAY_TAGS);

  return {
    // Profile-level override wins; otherwise fall back to the account name.
    displayName:
      data.display_name ||
      (data.owner as { display_name?: string | null } | null)?.display_name ||
      "Builder",
    headline: data.headline ?? null,
    bio: data.bio ?? null,
    linkedinUrl: data.linkedin_url ?? null,
    githubUrl: data.github_url ?? null,
    portfolioUrl: data.portfolio_url ?? null,
    educationSchool: data.education_school ?? null,
    educationMajor: data.education_major ?? null,
    educationYear: data.education_year ?? null,
    tags,
    avatarUrl,
    hasResume: !!data.resume_storage_path,
    githubUsername: connection?.github_username ?? null,
    githubSyncedAt: data.github_synced_at ?? null,
    projects: projectList,
    experience: experienceList,
    codingTools: codingToolList,
  };
}

export async function getPublicResumeUrl(
  token: string
): Promise<{ url?: string; error?: string }> {
  if (!TOKEN_RE.test(token)) return { error: "Invalid link." };

  const admin = createAdminClient();
  const { data } = await admin
    .from("builder_profiles")
    .select("is_published, resume_storage_path, user_id, token_expires_at, token_revoked_at")
    .eq("token", token)
    .maybeSingle();

  if (!data || !data.resume_storage_path) {
    return { error: "Resume not available." };
  }
  // Reject revoked or expired share links (see migration 0062).
  if (
    data.token_revoked_at ||
    (data.token_expires_at && new Date(data.token_expires_at as string) < new Date())
  ) {
    return { error: "This link has expired." };
  }

  // Unpublished resumes are visible only to the owner (profile preview).
  if (!data.is_published) {
    const current = await getCurrentProfile();
    if (!current || current.id !== data.user_id) {
      return { error: "Resume not available." };
    }
  }

  const { data: signed, error } = await admin.storage
    .from("resumes")
    .createSignedUrl(data.resume_storage_path, 60);
  if (error) return { error: error.message };
  return { url: signed.signedUrl };
}
