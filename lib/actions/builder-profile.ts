"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { normalizeUrl, githubProfileUrl } from "@/lib/project/business-context";
import { parseResume } from "@/lib/ai/parse-resume";
import { parsePortfolio } from "@/lib/ai/parse-portfolio";
import { fetchPortfolioSite } from "@/lib/portfolio/fetch-site";
import { friendlyAiError } from "@/lib/ai/client";
import { decryptSecret } from "@/lib/crypto";
import { fetchRepoShowcaseStats } from "@/lib/github/profile-stats";
import { RateLimitError, AuthError } from "@/lib/github/types";
import { deriveProfileTags } from "@/lib/builder-profile/derive-tags";
import {
  CODING_TOOL_CATEGORIES,
  type BuilderProfile,
  type BuilderProfileCodingTool,
  type BuilderProfileExperience,
  type BuilderProfileProject,
} from "@/lib/types";

const RESUMES_BUCKET = "resumes";
const MAX_RESUME_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_FEATURED_REPOS = 8;
const SYNC_CONCURRENCY = 3;

const AVATARS_BUCKET = "avatars";
const MAX_AVATAR_SIZE = 5 * 1024 * 1024; // 5 MB
const AVATAR_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
// Long enough to outlive any cached render of the pages that embed it.
const AVATAR_SIGNED_URL_TTL = 60 * 60 * 24;

export interface BuilderProfileBundle {
  profile: BuilderProfile;
  projects: BuilderProfileProject[];
  experience: BuilderProfileExperience[];
  codingTools: BuilderProfileCodingTool[];
  githubConnected: boolean;
  githubUsername: string | null;
  avatarUrl: string | null;
  // Badges derived from the rest of the profile, excluding any the builder has
  // already added by hand. Read-only in the editor (see TagsEditor).
  autoTags: string[];
}

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : await createClient();
}

// Every mutation re-checks ownership explicitly: dev profiles use the admin
// client, so RLS alone can't be trusted to scope rows.
async function getOwnedProfile(profileId: string): Promise<BuilderProfile | null> {
  const supabase = await getClient(profileId);
  const { data } = await supabase
    .from("builder_profiles")
    .select("*")
    .eq("user_id", profileId)
    .maybeSingle();
  return (data as BuilderProfile) ?? null;
}

async function requireBuilder() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { profile: null, error: "Only builders have a profile." };
  return { profile, error: null };
}

function revalidateProfile(token?: string) {
  revalidatePath("/b/profile");
  revalidatePath("/p/preview");
  if (token) revalidatePath(`/p/${token}`);
}

// ============================================================
// Read / bootstrap
// ============================================================

export async function getOrCreateBuilderProfile(): Promise<BuilderProfileBundle | null> {
  const { profile } = await requireBuilder();
  if (!profile) return null;

  const supabase = await getClient(profile.id);

  let row = await getOwnedProfile(profile.id);
  if (!row) {
    const { data, error } = await supabase
      .from("builder_profiles")
      .insert({ user_id: profile.id })
      .select("*")
      .single();
    if (error) {
      // Lost a creation race — the row exists now; fetch it.
      row = await getOwnedProfile(profile.id);
      if (!row) return null;
    } else {
      row = data as BuilderProfile;
    }
  }

  const [{ data: projects }, { data: experience }, { data: codingTools }, { data: connection }] =
    await Promise.all([
      supabase
        .from("builder_profile_projects")
        .select("*")
        .eq("builder_profile_id", row.id)
        .order("display_order", { ascending: true }),
      supabase
        .from("builder_profile_experience")
        .select("*")
        .eq("builder_profile_id", row.id)
        .order("display_order", { ascending: true }),
      supabase
        .from("builder_profile_coding_tools")
        .select("*")
        .eq("builder_profile_id", row.id)
        .order("display_order", { ascending: true }),
      createAdminClient()
        .from("github_connections")
        .select("github_username")
        .eq("user_id", profile.id)
        .maybeSingle(),
    ]);

  // Not exported: signing arbitrary caller-supplied paths would be an IDOR.
  let avatarUrl: string | null = null;
  if (row.avatar_storage_path) {
    const { data: signed } = await createAdminClient()
      .storage.from(AVATARS_BUCKET)
      .createSignedUrl(row.avatar_storage_path, AVATAR_SIGNED_URL_TTL);
    avatarUrl = signed?.signedUrl ?? null;
  }

  const projectList = (projects ?? []) as BuilderProfileProject[];
  const experienceList = (experience ?? []) as BuilderProfileExperience[];
  const codingToolList = (codingTools ?? []) as BuilderProfileCodingTool[];

  // Drop any derived tag the builder already added by hand so it isn't shown
  // twice (once as a manual chip, once as an auto chip).
  const manualKeys = new Set(row.tags.map((t) => t.toLowerCase()));
  const autoTags = deriveProfileTags({
    headline: row.headline,
    bio: row.bio,
    educationSchool: row.education_school,
    educationMajor: row.education_major,
    educationYear: row.education_year,
    experience: experienceList,
    projects: projectList,
    codingTools: codingToolList,
  }).filter((t) => !manualKeys.has(t.toLowerCase()));

  return {
    profile: row,
    projects: projectList,
    experience: experienceList,
    codingTools: codingToolList,
    githubConnected: !!connection,
    githubUsername: connection?.github_username ?? null,
    avatarUrl,
    autoTags,
  };
}

// ============================================================
// Identity (avatar badge)
// ============================================================

export interface BuilderIdentity {
  displayName: string | null;
  avatarUrl: string | null;
  initials: string;
}

/** Initials for an avatar fallback: first letters of up to two words. */
function deriveInitials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "•";
  return parts
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join("");
}

/** The current builder's display name, signed avatar URL, and initials — for the
    small avatar badge on the engagement cards / hero. Self-scoped: it signs only
    the caller's OWN avatar_storage_path (no caller-supplied path), so it's safe to
    export where getOrCreateBuilderProfile's full bundle would be overkill. Falls
    back to the account display name when no builder_profiles row exists yet
    (e.g. the dev builder). */
export async function getMyBuilderIdentity(): Promise<BuilderIdentity | null> {
  const { profile } = await requireBuilder();
  if (!profile) return null;

  const supabase = await getClient(profile.id);
  const { data: row } = await supabase
    .from("builder_profiles")
    .select("display_name, avatar_storage_path")
    .eq("user_id", profile.id)
    .maybeSingle();

  const displayName = row?.display_name ?? profile.display_name ?? null;

  let avatarUrl: string | null = null;
  if (row?.avatar_storage_path) {
    const { data: signed } = await createAdminClient()
      .storage.from(AVATARS_BUCKET)
      .createSignedUrl(row.avatar_storage_path, AVATAR_SIGNED_URL_TTL);
    avatarUrl = signed?.signedUrl ?? null;
  }

  return { displayName, avatarUrl, initials: deriveInitials(displayName) };
}

// ============================================================
// Basics
// ============================================================

const basicsSchema = z.object({
  display_name: z
    .string()
    .trim()
    .max(80, "Display name must be 80 characters or fewer.")
    .optional(),
  headline: z.string().trim().max(120, "Headline must be 120 characters or fewer.").optional(),
  bio: z.string().trim().max(2000, "Bio must be 2000 characters or fewer.").optional(),
  linkedin_url: z.string().trim().max(500).nullable().optional(),
  github_url: z.string().trim().max(500).nullable().optional(),
  portfolio_url: z.string().trim().max(500).nullable().optional(),
  education_school: z
    .string()
    .trim()
    .max(120, "School must be 120 characters or fewer.")
    .optional(),
  education_major: z
    .string()
    .trim()
    .max(120, "Major must be 120 characters or fewer.")
    .optional(),
  education_year: z.string().trim().max(40, "Year must be 40 characters or fewer.").optional(),
});

export async function updateProfileBasics(input: {
  display_name?: string;
  headline?: string;
  bio?: string;
  linkedin_url?: string | null;
  github_url?: string | null;
  portfolio_url?: string | null;
  education_school?: string;
  education_major?: string;
  education_year?: string;
}): Promise<{ success?: boolean; error?: string }> {
  const { profile, error: roleError } = await requireBuilder();
  if (!profile) return { error: roleError! };

  const parsed = basicsSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const row = await getOwnedProfile(profile.id);
  if (!row) return { error: "Profile not found." };

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.display_name !== undefined) updates.display_name = parsed.data.display_name || null;
  if (parsed.data.headline !== undefined) updates.headline = parsed.data.headline || null;
  if (parsed.data.bio !== undefined) updates.bio = parsed.data.bio || null;
  if (parsed.data.education_school !== undefined)
    updates.education_school = parsed.data.education_school || null;
  if (parsed.data.education_major !== undefined)
    updates.education_major = parsed.data.education_major || null;
  if (parsed.data.education_year !== undefined)
    updates.education_year = parsed.data.education_year || null;
  if (parsed.data.linkedin_url !== undefined) {
    if (parsed.data.linkedin_url) {
      const normalized = normalizeUrl(parsed.data.linkedin_url);
      if (!normalized || !/linkedin\.com\//i.test(normalized)) {
        return { error: "Enter a valid LinkedIn URL." };
      }
      updates.linkedin_url = normalized;
    } else {
      updates.linkedin_url = null;
    }
  }
  if (parsed.data.github_url !== undefined) {
    if (parsed.data.github_url) {
      // A bare handle ("octocat") expands to the full profile URL first.
      const normalized = normalizeUrl(githubProfileUrl(parsed.data.github_url));
      if (!normalized || !/github\.com\//i.test(normalized)) {
        return { error: "Enter a valid GitHub username or URL." };
      }
      updates.github_url = normalized;
    } else {
      updates.github_url = null;
    }
  }
  if (parsed.data.portfolio_url !== undefined) {
    if (parsed.data.portfolio_url) {
      const normalized = normalizeUrl(parsed.data.portfolio_url);
      if (!normalized) return { error: "Enter a valid portfolio URL." };
      updates.portfolio_url = normalized;
    } else {
      updates.portfolio_url = null;
    }
  }

  const supabase = await getClient(profile.id);
  const { error } = await supabase.from("builder_profiles").update(updates).eq("id", row.id);
  if (error) return { error: error.message };

  revalidateProfile(row.token);
  return { success: true };
}

// ============================================================
// Tags (achievement / identity badges)
// ============================================================

const MAX_TAGS = 10;

const tagsSchema = z.object({
  tags: z
    .array(z.string().trim().min(1).max(40, "Each tag must be 40 characters or fewer."))
    .max(MAX_TAGS, `You can add up to ${MAX_TAGS} tags.`),
});

export async function updateProfileTags(input: {
  tags: string[];
}): Promise<{ success?: boolean; error?: string }> {
  const { profile, error: roleError } = await requireBuilder();
  if (!profile) return { error: roleError! };

  const parsed = tagsSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  // Dedupe case-insensitively, preserving first-seen order and casing.
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const t of parsed.data.tags) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(t);
  }

  const row = await getOwnedProfile(profile.id);
  if (!row) return { error: "Profile not found." };

  const supabase = await getClient(profile.id);
  const { error } = await supabase
    .from("builder_profiles")
    .update({ tags, updated_at: new Date().toISOString() })
    .eq("id", row.id);
  if (error) return { error: error.message };

  revalidateProfile(row.token);
  return { success: true };
}

// ============================================================
// GitHub showcase
// ============================================================

const featuredReposSchema = z
  .array(
    z.object({
      repoId: z.number().int().positive(),
      fullName: z.string().min(3).max(200).regex(/^[^/\s]+\/[^/\s]+$/),
      isPrivate: z.boolean(),
    })
  )
  .max(MAX_FEATURED_REPOS, `You can feature up to ${MAX_FEATURED_REPOS} repositories.`);

export async function setFeaturedRepos(
  repos: { repoId: number; fullName: string; isPrivate: boolean }[]
): Promise<{ success?: boolean; synced?: number; error?: string }> {
  const { profile, error: roleError } = await requireBuilder();
  if (!profile) return { error: roleError! };

  const parsed = featuredReposSchema.safeParse(repos);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid selection." };

  const row = await getOwnedProfile(profile.id);
  if (!row) return { error: "Profile not found." };

  const supabase = await getClient(profile.id);

  const { data: existing } = await supabase
    .from("builder_profile_projects")
    .select("id, github_repo_id, display_order")
    .eq("builder_profile_id", row.id)
    .eq("source", "github");

  const keepIds = new Set(parsed.data.map((r) => r.repoId));
  const removed = (existing ?? []).filter((p) => !keepIds.has(Number(p.github_repo_id)));
  if (removed.length > 0) {
    const { error } = await supabase
      .from("builder_profile_projects")
      .delete()
      .in("id", removed.map((p) => p.id));
    if (error) return { error: error.message };
  }

  const existingIds = new Set((existing ?? []).map((p) => Number(p.github_repo_id)));
  const added = parsed.data.filter((r) => !existingIds.has(r.repoId));
  if (added.length > 0) {
    const { data: maxRow } = await supabase
      .from("builder_profile_projects")
      .select("display_order")
      .eq("builder_profile_id", row.id)
      .order("display_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    let nextOrder = (maxRow?.display_order ?? -1) + 1;

    const { error } = await supabase.from("builder_profile_projects").insert(
      added.map((r) => ({
        builder_profile_id: row.id,
        source: "github",
        name: r.fullName.split("/")[1] ?? r.fullName,
        url: `https://github.com/${r.fullName}`,
        github_repo_id: r.repoId,
        github_repo_full_name: r.fullName,
        github_is_private: r.isPrivate,
        display_order: nextOrder++,
      }))
    );
    if (error) return { error: error.message };
  }

  const sync = await syncGithubProjects();
  revalidateProfile(row.token);
  if (sync.error && !sync.success) return { error: sync.error };
  return { success: true, synced: sync.synced ?? 0 };
}

export async function syncGithubProjects(): Promise<{
  success?: boolean;
  synced?: number;
  failed?: number;
  error?: string;
}> {
  const { profile, error: roleError } = await requireBuilder();
  if (!profile) return { error: roleError! };

  const row = await getOwnedProfile(profile.id);
  if (!row) return { error: "Profile not found." };

  const admin = createAdminClient();
  const { data: connection } = await admin
    .from("github_connections")
    .select("access_token, github_username")
    .eq("user_id", profile.id)
    .maybeSingle();
  if (!connection?.access_token || !connection.github_username) {
    return { error: "Connect GitHub from the Repo tab first." };
  }

  const supabase = await getClient(profile.id);
  const { data: githubRows } = await supabase
    .from("builder_profile_projects")
    .select("id, github_repo_full_name")
    .eq("builder_profile_id", row.id)
    .eq("source", "github");

  const targets = (githubRows ?? []) as { id: string; github_repo_full_name: string }[];
  if (targets.length === 0) {
    return { success: true, synced: 0, failed: 0 };
  }

  let synced = 0;
  let failed = 0;
  let abortError: string | null = null;

  // Small batches keep us gentle on the API; auth/rate-limit failures abort
  // the rest but never wipe existing snapshots — stale beats empty.
  for (let i = 0; i < targets.length && !abortError; i += SYNC_CONCURRENCY) {
    const batch = targets.slice(i, i + SYNC_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((t) =>
        fetchRepoShowcaseStats(
          decryptSecret(connection.access_token),
          t.github_repo_full_name,
          connection.github_username
        )
      )
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      const target = batch[j];
      if (result.status === "rejected") {
        if (result.reason instanceof AuthError) {
          abortError = "Your GitHub token is no longer valid. Reconnect GitHub from the Repo tab.";
          break;
        }
        if (result.reason instanceof RateLimitError) {
          abortError = "GitHub rate limit hit. Try syncing again in a few minutes.";
          break;
        }
        failed++; // repo deleted, renamed, or access lost — snapshot stays
        continue;
      }
      const stats = result.value;
      if (!stats) {
        failed++;
        continue;
      }
      const { error } = await supabase
        .from("builder_profile_projects")
        .update({
          name: target.github_repo_full_name.split("/")[1] ?? target.github_repo_full_name,
          description: stats.description,
          url: `https://github.com/${target.github_repo_full_name}`,
          github_is_private: stats.isPrivate,
          commit_count: stats.commitCount,
          languages: stats.languages,
          stars: stats.stars,
          github_pushed_at: stats.pushedAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", target.id);
      if (error) failed++;
      else synced++;
    }
  }

  if (synced > 0) {
    await supabase
      .from("builder_profiles")
      .update({ github_synced_at: new Date().toISOString() })
      .eq("id", row.id);
  }

  revalidateProfile(row.token);

  if (abortError && synced === 0) return { error: abortError };
  return { success: true, synced, failed, ...(abortError ? { error: abortError } : {}) };
}

// ============================================================
// Manual projects
// ============================================================

const manualProjectSchema = z.object({
  name: z.string().trim().min(1, "Project name is required.").max(120),
  description: z.string().trim().max(1000).optional(),
  url: z.string().trim().max(500).optional(),
  liveUrl: z.string().trim().max(500).optional(),
  tech: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
});

export async function addManualProject(input: {
  name: string;
  description?: string;
  url?: string;
  liveUrl?: string;
  tech?: string[];
}): Promise<{ success?: boolean; project?: BuilderProfileProject; error?: string }> {
  const { profile, error: roleError } = await requireBuilder();
  if (!profile) return { error: roleError! };

  const parsed = manualProjectSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const row = await getOwnedProfile(profile.id);
  if (!row) return { error: "Profile not found." };

  let url: string | null = null;
  if (parsed.data.url) {
    url = normalizeUrl(parsed.data.url);
    if (!url) return { error: "Enter a valid URL." };
  }
  let liveUrl: string | null = null;
  if (parsed.data.liveUrl) {
    liveUrl = normalizeUrl(parsed.data.liveUrl);
    if (!liveUrl) return { error: "Enter a valid live work URL." };
  }

  const supabase = await getClient(profile.id);
  const { data: maxRow } = await supabase
    .from("builder_profile_projects")
    .select("display_order")
    .eq("builder_profile_id", row.id)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("builder_profile_projects")
    .insert({
      builder_profile_id: row.id,
      source: "manual",
      name: parsed.data.name,
      description: parsed.data.description || null,
      url,
      live_url: liveUrl,
      tech: parsed.data.tech ?? [],
      display_order: (maxRow?.display_order ?? -1) + 1,
    })
    .select("*")
    .single();
  if (error) return { error: error.message };

  revalidateProfile(row.token);
  return { success: true, project: data as BuilderProfileProject };
}

export async function updateProfileProject(
  id: string,
  input: { name?: string; description?: string; url?: string; liveUrl?: string; tech?: string[] }
): Promise<{ success?: boolean; error?: string }> {
  const { profile, error: roleError } = await requireBuilder();
  if (!profile) return { error: roleError! };

  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid ID." };
  const parsed = manualProjectSchema.partial().safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const row = await getOwnedProfile(profile.id);
  if (!row) return { error: "Profile not found." };

  const supabase = await getClient(profile.id);
  const { data: project } = await supabase
    .from("builder_profile_projects")
    .select("id, source")
    .eq("id", id)
    .eq("builder_profile_id", row.id)
    .maybeSingle();
  if (!project) return { error: "Project not found." };
  // GitHub rows are synced snapshots — only the builder-set live link is
  // editable on them; everything else would be clobbered on the next sync.
  if (
    project.source !== "manual" &&
    (parsed.data.name !== undefined ||
      parsed.data.description !== undefined ||
      parsed.data.url !== undefined ||
      parsed.data.tech !== undefined)
  ) {
    return { error: "GitHub projects are synced — only the live link can be edited." };
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description || null;
  if (parsed.data.tech !== undefined) updates.tech = parsed.data.tech;
  if (parsed.data.url !== undefined) {
    if (parsed.data.url) {
      const normalized = normalizeUrl(parsed.data.url);
      if (!normalized) return { error: "Enter a valid URL." };
      updates.url = normalized;
    } else {
      updates.url = null;
    }
  }
  if (parsed.data.liveUrl !== undefined) {
    if (parsed.data.liveUrl) {
      const normalized = normalizeUrl(parsed.data.liveUrl);
      if (!normalized) return { error: "Enter a valid live work URL." };
      updates.live_url = normalized;
    } else {
      updates.live_url = null;
    }
  }

  const { error } = await supabase
    .from("builder_profile_projects")
    .update(updates)
    .eq("id", id);
  if (error) return { error: error.message };

  revalidateProfile(row.token);
  return { success: true };
}

export async function deleteProfileProject(
  id: string
): Promise<{ success?: boolean; error?: string }> {
  const { profile, error: roleError } = await requireBuilder();
  if (!profile) return { error: roleError! };

  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid ID." };

  const row = await getOwnedProfile(profile.id);
  if (!row) return { error: "Profile not found." };

  const supabase = await getClient(profile.id);
  const { error } = await supabase
    .from("builder_profile_projects")
    .delete()
    .eq("id", id)
    .eq("builder_profile_id", row.id);
  if (error) return { error: error.message };

  revalidateProfile(row.token);
  return { success: true };
}

export async function reorderProfileProjects(
  orderedIds: string[]
): Promise<{ success?: boolean; error?: string }> {
  const { profile, error: roleError } = await requireBuilder();
  if (!profile) return { error: roleError! };

  const parsed = z.array(z.string().uuid()).max(100).safeParse(orderedIds);
  if (!parsed.success) return { error: "Invalid order." };

  const row = await getOwnedProfile(profile.id);
  if (!row) return { error: "Profile not found." };

  const supabase = await getClient(profile.id);
  for (let i = 0; i < parsed.data.length; i++) {
    await supabase
      .from("builder_profile_projects")
      .update({ display_order: i })
      .eq("id", parsed.data[i])
      .eq("builder_profile_id", row.id);
  }

  revalidateProfile(row.token);
  return { success: true };
}

// ============================================================
// Experience
// ============================================================

const experienceSchema = z.object({
  role: z.string().trim().min(1, "Role is required.").max(120),
  company: z.string().trim().min(1, "Company is required.").max(120),
  // Website host from the company autocomplete ("patelgaines.com"); "" clears it.
  company_domain: z.string().trim().toLowerCase().max(255).optional(),
  start_label: z.string().trim().max(40).optional(),
  end_label: z.string().trim().max(40).optional(),
  description: z.string().trim().max(1000).optional(),
});

export async function addExperience(input: {
  role: string;
  company: string;
  company_domain?: string;
  start_label?: string;
  end_label?: string;
  description?: string;
}): Promise<{ success?: boolean; entry?: BuilderProfileExperience; error?: string }> {
  const { profile, error: roleError } = await requireBuilder();
  if (!profile) return { error: roleError! };

  const parsed = experienceSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const row = await getOwnedProfile(profile.id);
  if (!row) return { error: "Profile not found." };

  const supabase = await getClient(profile.id);
  const { data: maxRow } = await supabase
    .from("builder_profile_experience")
    .select("display_order")
    .eq("builder_profile_id", row.id)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("builder_profile_experience")
    .insert({
      builder_profile_id: row.id,
      role: parsed.data.role,
      company: parsed.data.company,
      company_domain: parsed.data.company_domain || null,
      start_label: parsed.data.start_label || null,
      end_label: parsed.data.end_label || null,
      description: parsed.data.description || null,
      display_order: (maxRow?.display_order ?? -1) + 1,
    })
    .select("*")
    .single();
  if (error) return { error: error.message };

  revalidateProfile(row.token);
  return { success: true, entry: data as BuilderProfileExperience };
}

export async function updateExperience(
  id: string,
  input: {
    role?: string;
    company?: string;
    company_domain?: string;
    start_label?: string;
    end_label?: string;
    description?: string;
  }
): Promise<{ success?: boolean; error?: string }> {
  const { profile, error: roleError } = await requireBuilder();
  if (!profile) return { error: roleError! };

  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid ID." };
  const parsed = experienceSchema.partial().safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const row = await getOwnedProfile(profile.id);
  if (!row) return { error: "Profile not found." };

  const updates: Record<string, unknown> = {};
  if (parsed.data.role !== undefined) updates.role = parsed.data.role;
  if (parsed.data.company !== undefined) updates.company = parsed.data.company;
  if (parsed.data.company_domain !== undefined)
    updates.company_domain = parsed.data.company_domain || null;
  if (parsed.data.start_label !== undefined) updates.start_label = parsed.data.start_label || null;
  if (parsed.data.end_label !== undefined) updates.end_label = parsed.data.end_label || null;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description || null;

  const supabase = await getClient(profile.id);
  const { error } = await supabase
    .from("builder_profile_experience")
    .update(updates)
    .eq("id", id)
    .eq("builder_profile_id", row.id);
  if (error) return { error: error.message };

  revalidateProfile(row.token);
  return { success: true };
}

export async function deleteExperience(
  id: string
): Promise<{ success?: boolean; error?: string }> {
  const { profile, error: roleError } = await requireBuilder();
  if (!profile) return { error: roleError! };

  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid ID." };

  const row = await getOwnedProfile(profile.id);
  if (!row) return { error: "Profile not found." };

  const supabase = await getClient(profile.id);
  const { error } = await supabase
    .from("builder_profile_experience")
    .delete()
    .eq("id", id)
    .eq("builder_profile_id", row.id);
  if (error) return { error: error.message };

  revalidateProfile(row.token);
  return { success: true };
}

export async function reorderExperience(
  orderedIds: string[]
): Promise<{ success?: boolean; error?: string }> {
  const { profile, error: roleError } = await requireBuilder();
  if (!profile) return { error: roleError! };

  const parsed = z.array(z.string().uuid()).max(100).safeParse(orderedIds);
  if (!parsed.success) return { error: "Invalid order." };

  const row = await getOwnedProfile(profile.id);
  if (!row) return { error: "Profile not found." };

  const supabase = await getClient(profile.id);
  for (let i = 0; i < parsed.data.length; i++) {
    await supabase
      .from("builder_profile_experience")
      .update({ display_order: i })
      .eq("id", parsed.data[i])
      .eq("builder_profile_id", row.id);
  }

  revalidateProfile(row.token);
  return { success: true };
}

// ============================================================
// Coding tools
// ============================================================

const codingToolSchema = z.object({
  name: z.string().trim().min(1, "Tool name is required.").max(80),
  // "" clears the category; any other value must be a known bucket.
  category: z.enum(CODING_TOOL_CATEGORIES).or(z.literal("")).optional(),
  url: z.string().trim().max(500).optional(),
});

export async function addCodingTool(input: {
  name: string;
  category?: string;
  url?: string;
}): Promise<{ success?: boolean; entry?: BuilderProfileCodingTool; error?: string }> {
  const { profile, error: roleError } = await requireBuilder();
  if (!profile) return { error: roleError! };

  const parsed = codingToolSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const row = await getOwnedProfile(profile.id);
  if (!row) return { error: "Profile not found." };

  let url: string | null = null;
  if (parsed.data.url) {
    url = normalizeUrl(parsed.data.url);
    if (!url) return { error: "Enter a valid URL." };
  }

  const supabase = await getClient(profile.id);
  const { data: maxRow } = await supabase
    .from("builder_profile_coding_tools")
    .select("display_order")
    .eq("builder_profile_id", row.id)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("builder_profile_coding_tools")
    .insert({
      builder_profile_id: row.id,
      name: parsed.data.name,
      category: parsed.data.category || null,
      url,
      display_order: (maxRow?.display_order ?? -1) + 1,
    })
    .select("*")
    .single();
  if (error) return { error: error.message };

  revalidateProfile(row.token);
  return { success: true, entry: data as BuilderProfileCodingTool };
}

export async function addCodingTools(
  inputs: { name: string; category?: string; url?: string }[]
): Promise<{ success?: boolean; count?: number; error?: string }> {
  const { profile, error: roleError } = await requireBuilder();
  if (!profile) return { error: roleError! };

  if (!inputs.length) return { error: "Select at least one tool." };
  if (inputs.length > 50) return { error: "Too many tools at once." };

  // Validate + normalize every row up front so the whole batch is rejected on
  // the first bad entry (no partial inserts).
  const rows: { name: string; category: string | null; url: string | null }[] = [];
  for (const input of inputs) {
    const parsed = codingToolSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
    let url: string | null = null;
    if (parsed.data.url) {
      url = normalizeUrl(parsed.data.url);
      if (!url) return { error: "Enter a valid URL." };
    }
    rows.push({ name: parsed.data.name, category: parsed.data.category || null, url });
  }

  const row = await getOwnedProfile(profile.id);
  if (!row) return { error: "Profile not found." };

  const supabase = await getClient(profile.id);
  const { data: maxRow } = await supabase
    .from("builder_profile_coding_tools")
    .select("display_order")
    .eq("builder_profile_id", row.id)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  let nextOrder = (maxRow?.display_order ?? -1) + 1;

  const { error } = await supabase.from("builder_profile_coding_tools").insert(
    rows.map((r) => ({
      builder_profile_id: row.id,
      name: r.name,
      category: r.category,
      url: r.url,
      display_order: nextOrder++,
    }))
  );
  if (error) return { error: error.message };

  revalidateProfile(row.token);
  return { success: true, count: rows.length };
}

export async function updateCodingTool(
  id: string,
  input: { name?: string; category?: string; url?: string }
): Promise<{ success?: boolean; error?: string }> {
  const { profile, error: roleError } = await requireBuilder();
  if (!profile) return { error: roleError! };

  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid ID." };
  const parsed = codingToolSchema.partial().safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const row = await getOwnedProfile(profile.id);
  if (!row) return { error: "Profile not found." };

  const updates: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.category !== undefined) updates.category = parsed.data.category || null;
  if (parsed.data.url !== undefined) {
    if (parsed.data.url) {
      const normalized = normalizeUrl(parsed.data.url);
      if (!normalized) return { error: "Enter a valid URL." };
      updates.url = normalized;
    } else {
      updates.url = null;
    }
  }

  const supabase = await getClient(profile.id);
  const { error } = await supabase
    .from("builder_profile_coding_tools")
    .update(updates)
    .eq("id", id)
    .eq("builder_profile_id", row.id);
  if (error) return { error: error.message };

  revalidateProfile(row.token);
  return { success: true };
}

export async function deleteCodingTool(
  id: string
): Promise<{ success?: boolean; error?: string }> {
  const { profile, error: roleError } = await requireBuilder();
  if (!profile) return { error: roleError! };

  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid ID." };

  const row = await getOwnedProfile(profile.id);
  if (!row) return { error: "Profile not found." };

  const supabase = await getClient(profile.id);
  const { error } = await supabase
    .from("builder_profile_coding_tools")
    .delete()
    .eq("id", id)
    .eq("builder_profile_id", row.id);
  if (error) return { error: error.message };

  revalidateProfile(row.token);
  return { success: true };
}

export async function reorderCodingTools(
  orderedIds: string[]
): Promise<{ success?: boolean; error?: string }> {
  const { profile, error: roleError } = await requireBuilder();
  if (!profile) return { error: roleError! };

  const parsed = z.array(z.string().uuid()).max(100).safeParse(orderedIds);
  if (!parsed.success) return { error: "Invalid order." };

  const row = await getOwnedProfile(profile.id);
  if (!row) return { error: "Profile not found." };

  const supabase = await getClient(profile.id);
  for (let i = 0; i < parsed.data.length; i++) {
    await supabase
      .from("builder_profile_coding_tools")
      .update({ display_order: i })
      .eq("id", parsed.data[i])
      .eq("builder_profile_id", row.id);
  }

  revalidateProfile(row.token);
  return { success: true };
}

// ============================================================
// Resume upload
// ============================================================

export async function uploadResume(
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const { profile, error: roleError } = await requireBuilder();
  if (!profile) return { error: roleError! };

  const row = await getOwnedProfile(profile.id);
  if (!row) return { error: "Profile not found." };

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "No file provided." };
  if (file.size === 0) return { error: "File is empty." };
  if (file.size > MAX_RESUME_SIZE) return { error: "Resume exceeds 10 MB limit." };

  const isPdf =
    file.name.toLowerCase().endsWith(".pdf") && (file.type === "application/pdf" || !file.type);
  if (!isPdf) return { error: "Resume must be a PDF." };

  const storagePath = `resumes/${profile.id}/${crypto.randomUUID()}.pdf`;
  const supabase = await getClient(profile.id);

  const { error: storageError } = await supabase.storage
    .from(RESUMES_BUCKET)
    .upload(storagePath, file, { contentType: "application/pdf" });
  if (storageError) return { error: storageError.message };

  const previousPath = row.resume_storage_path;
  const { error: dbError } = await supabase
    .from("builder_profiles")
    .update({
      resume_storage_path: storagePath,
      resume_file_name: file.name,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);

  const adminClient = createAdminClient();
  if (dbError) {
    // Roll back the orphaned object so storage doesn't drift from the table.
    await adminClient.storage.from(RESUMES_BUCKET).remove([storagePath]);
    return { error: dbError.message };
  }
  if (previousPath) {
    await adminClient.storage.from(RESUMES_BUCKET).remove([previousPath]);
  }

  revalidateProfile(row.token);
  return { success: true };
}

export async function deleteResume(): Promise<{ success?: boolean; error?: string }> {
  const { profile, error: roleError } = await requireBuilder();
  if (!profile) return { error: roleError! };

  const row = await getOwnedProfile(profile.id);
  if (!row) return { error: "Profile not found." };
  if (!row.resume_storage_path) return { error: "No resume uploaded." };

  const supabase = await getClient(profile.id);
  const { error } = await supabase
    .from("builder_profiles")
    .update({ resume_storage_path: null, resume_file_name: null, updated_at: new Date().toISOString() })
    .eq("id", row.id);
  if (error) return { error: error.message };

  const adminClient = createAdminClient();
  await adminClient.storage.from(RESUMES_BUCKET).remove([row.resume_storage_path]);

  revalidateProfile(row.token);
  return { success: true };
}

// ============================================================
// Profile picture
// ============================================================

let avatarsBucketReady = false;

// The avatars bucket is created lazily so no manual Storage setup is needed.
// createBucket is idempotent enough: "already exists" counts as success.
async function ensureAvatarsBucket(admin: ReturnType<typeof createAdminClient>) {
  if (avatarsBucketReady) return;
  const { error } = await admin.storage.createBucket(AVATARS_BUCKET, {
    public: false,
    fileSizeLimit: MAX_AVATAR_SIZE,
    allowedMimeTypes: Object.keys(AVATAR_TYPES),
  });
  if (!error || /already exists/i.test(error.message)) avatarsBucketReady = true;
}

export async function uploadAvatar(
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const { profile, error: roleError } = await requireBuilder();
  if (!profile) return { error: roleError! };

  const row = await getOwnedProfile(profile.id);
  if (!row) return { error: "Profile not found." };

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "No file provided." };
  if (file.size === 0) return { error: "File is empty." };
  if (file.size > MAX_AVATAR_SIZE) return { error: "Photo exceeds 5 MB limit." };

  const ext = AVATAR_TYPES[file.type];
  if (!ext) return { error: "Photo must be a JPEG, PNG, or WebP image." };

  // Ownership is verified above; the admin client handles storage so the
  // bucket can be created on demand (mirrors importFromResume's storage use).
  const admin = createAdminClient();
  await ensureAvatarsBucket(admin);

  const storagePath = `avatars/${profile.id}/${crypto.randomUUID()}.${ext}`;
  const { error: storageError } = await admin.storage
    .from(AVATARS_BUCKET)
    .upload(storagePath, file, { contentType: file.type });
  if (storageError) return { error: storageError.message };

  const previousPath = row.avatar_storage_path;
  const supabase = await getClient(profile.id);
  const { error: dbError } = await supabase
    .from("builder_profiles")
    .update({ avatar_storage_path: storagePath, updated_at: new Date().toISOString() })
    .eq("id", row.id);

  if (dbError) {
    // Roll back the orphaned object so storage doesn't drift from the table.
    await admin.storage.from(AVATARS_BUCKET).remove([storagePath]);
    return { error: dbError.message };
  }
  if (previousPath) {
    await admin.storage.from(AVATARS_BUCKET).remove([previousPath]);
  }

  revalidateProfile(row.token);
  return { success: true };
}

export async function deleteAvatar(): Promise<{ success?: boolean; error?: string }> {
  const { profile, error: roleError } = await requireBuilder();
  if (!profile) return { error: roleError! };

  const row = await getOwnedProfile(profile.id);
  if (!row) return { error: "Profile not found." };
  if (!row.avatar_storage_path) return { error: "No photo uploaded." };

  const supabase = await getClient(profile.id);
  const { error } = await supabase
    .from("builder_profiles")
    .update({ avatar_storage_path: null, updated_at: new Date().toISOString() })
    .eq("id", row.id);
  if (error) return { error: error.message };

  const adminClient = createAdminClient();
  await adminClient.storage.from(AVATARS_BUCKET).remove([row.avatar_storage_path]);

  revalidateProfile(row.token);
  return { success: true };
}

// ============================================================
// Resume → profile import
// ============================================================

export async function importFromResume(): Promise<{
  success?: boolean;
  imported?: number;
  skipped?: number;
  basicsUpdated?: boolean;
  error?: string;
}> {
  const { profile, error: roleError } = await requireBuilder();
  if (!profile) return { error: roleError! };

  const row = await getOwnedProfile(profile.id);
  if (!row) return { error: "Profile not found." };
  if (!row.resume_storage_path) return { error: "Upload a resume PDF first." };

  // Ownership is verified above; the admin client mirrors how deleteResume
  // touches storage.
  const admin = createAdminClient();
  const { data: blob, error: downloadError } = await admin.storage
    .from(RESUMES_BUCKET)
    .download(row.resume_storage_path);
  if (downloadError || !blob) return { error: "Couldn't read the uploaded resume. Try re-uploading it." };

  const pdfBase64 = Buffer.from(await blob.arrayBuffer()).toString("base64");

  let parsed;
  try {
    parsed = await parseResume(pdfBase64, row.resume_file_name ?? "resume.pdf", {
      userId: profile.id,
      operation: "parse_resume",
    });
  } catch (err) {
    return { error: friendlyAiError(err) };
  }
  if (!parsed) return { error: "Couldn't extract anything from the resume. Try again in a moment." };

  const supabase = await getClient(profile.id);

  const { data: existing } = await supabase
    .from("builder_profile_experience")
    .select("role, company, display_order")
    .eq("builder_profile_id", row.id);

  // Skip entries the builder already has so re-running the import is safe.
  const seen = new Set(
    (existing ?? []).map((e) => `${e.role}|${e.company}`.toLowerCase().trim())
  );
  const fresh = parsed.experience.filter(
    (e) => !seen.has(`${e.role}|${e.company}`.toLowerCase().trim())
  );
  const skipped = parsed.experience.length - fresh.length;

  let imported = 0;
  if (fresh.length > 0) {
    const maxOrder = Math.max(-1, ...(existing ?? []).map((e) => e.display_order ?? -1));
    const { error } = await supabase.from("builder_profile_experience").insert(
      fresh.map((e, i) => ({
        builder_profile_id: row.id,
        role: e.role,
        company: e.company,
        start_label: e.start_label || null,
        end_label: e.end_label || null,
        description: e.description || null,
        display_order: maxOrder + 1 + i,
      }))
    );
    if (error) return { error: error.message };
    imported = fresh.length;
  }

  // Only fill basics that are still blank — never overwrite the builder's
  // own words with AI output.
  const basicsUpdates: Record<string, unknown> = {};
  if (!row.headline?.trim() && parsed.headline) basicsUpdates.headline = parsed.headline;
  if (!row.bio?.trim() && parsed.bio) basicsUpdates.bio = parsed.bio;
  let basicsUpdated = false;
  if (Object.keys(basicsUpdates).length > 0) {
    basicsUpdates.updated_at = new Date().toISOString();
    const { error } = await supabase
      .from("builder_profiles")
      .update(basicsUpdates)
      .eq("id", row.id);
    if (!error) basicsUpdated = true;
  }

  if (imported === 0 && skipped === 0 && !basicsUpdated) {
    return { error: "No work experience found in the resume." };
  }

  revalidateProfile(row.token);
  return { success: true, imported, skipped, basicsUpdated };
}

// ============================================================
// Portfolio → profile import
// ============================================================

const portfolioImportSchema = z.object({
  url: z.string().trim().max(500).optional(),
});

export async function importFromPortfolio(input?: { url?: string }): Promise<{
  success?: boolean;
  experienceImported?: number;
  projectsImported?: number;
  skipped?: number;
  basicsUpdated?: boolean;
  linksUpdated?: boolean;
  educationUpdated?: boolean;
  error?: string;
}> {
  const { profile, error: roleError } = await requireBuilder();
  if (!profile) return { error: roleError! };

  const parsedInput = portfolioImportSchema.safeParse(input ?? {});
  if (!parsedInput.success) {
    return { error: parsedInput.error.issues[0]?.message ?? "Invalid input." };
  }

  const row = await getOwnedProfile(profile.id);
  if (!row) return { error: "Profile not found." };

  const url = normalizeUrl(parsedInput.data.url) ?? normalizeUrl(row.portfolio_url);
  if (!url) return { error: "Add your portfolio URL first." };

  const { site, error: fetchError } = await fetchPortfolioSite(url);
  if (!site) return { error: fetchError ?? "Couldn't read that site." };

  let parsed;
  try {
    parsed = await parsePortfolio(site.content, url, profile.id);
  } catch (err) {
    return { error: friendlyAiError(err) };
  }
  if (!parsed) return { error: "Couldn't extract anything from that site. Try again in a moment." };

  const supabase = await getClient(profile.id);

  // --- Experience: skip entries the builder already has so re-running is safe.
  const { data: existingExperience } = await supabase
    .from("builder_profile_experience")
    .select("role, company, display_order")
    .eq("builder_profile_id", row.id);

  const seenExperience = new Set(
    (existingExperience ?? []).map((e) => `${e.role}|${e.company}`.toLowerCase().trim())
  );
  const freshExperience = parsed.experience.filter(
    (e) => !seenExperience.has(`${e.role}|${e.company}`.toLowerCase().trim())
  );
  let skipped = parsed.experience.length - freshExperience.length;

  let experienceImported = 0;
  if (freshExperience.length > 0) {
    const maxOrder = Math.max(-1, ...(existingExperience ?? []).map((e) => e.display_order ?? -1));
    const { error } = await supabase.from("builder_profile_experience").insert(
      freshExperience.map((e, i) => ({
        builder_profile_id: row.id,
        role: e.role,
        company: e.company,
        start_label: e.start_label || null,
        end_label: e.end_label || null,
        description: e.description || null,
        display_order: maxOrder + 1 + i,
      }))
    );
    if (error) return { error: error.message };
    experienceImported = freshExperience.length;
  }

  // --- Projects: dedupe by name across ALL sources so a GitHub-synced repo
  // isn't re-added as a manual entry.
  const { data: existingProjects } = await supabase
    .from("builder_profile_projects")
    .select("name, display_order")
    .eq("builder_profile_id", row.id);

  const seenProjects = new Set(
    (existingProjects ?? []).map((p) => p.name.toLowerCase().trim())
  );
  const freshProjects = parsed.projects.filter(
    (p) => !seenProjects.has(p.name.toLowerCase().trim())
  );
  skipped += parsed.projects.length - freshProjects.length;

  let projectsImported = 0;
  if (freshProjects.length > 0) {
    const maxOrder = Math.max(-1, ...(existingProjects ?? []).map((p) => p.display_order ?? -1));
    const { error } = await supabase.from("builder_profile_projects").insert(
      freshProjects.map((p, i) => ({
        builder_profile_id: row.id,
        source: "manual",
        name: p.name,
        description: p.description || null,
        url: p.url || null,
        live_url: p.live_url || null,
        tech: p.tech,
        display_order: maxOrder + 1 + i,
      }))
    );
    if (error) return { error: error.message };
    projectsImported = freshProjects.length;
  }

  // --- Basics / links / education: only fill fields that are still blank —
  // never overwrite the builder's own words with AI output.
  const updates: Record<string, unknown> = {};
  let basicsUpdated = false;
  let linksUpdated = false;
  let educationUpdated = false;

  if (!row.headline?.trim() && parsed.headline) {
    updates.headline = parsed.headline;
    basicsUpdated = true;
  }
  if (!row.bio?.trim() && parsed.bio) {
    updates.bio = parsed.bio;
    basicsUpdated = true;
  }
  if (!row.linkedin_url?.trim() && parsed.linkedin_url) {
    updates.linkedin_url = parsed.linkedin_url;
    linksUpdated = true;
  }
  if (!row.github_url?.trim() && parsed.github_url) {
    updates.github_url = parsed.github_url;
    linksUpdated = true;
  }
  // The URL the builder imports from is their portfolio link — keep it saved.
  if (url !== normalizeUrl(row.portfolio_url)) {
    updates.portfolio_url = url;
    linksUpdated = true;
  }
  if (!row.education_school?.trim() && parsed.education_school) {
    updates.education_school = parsed.education_school;
    educationUpdated = true;
  }
  if (!row.education_major?.trim() && parsed.education_major) {
    updates.education_major = parsed.education_major;
    educationUpdated = true;
  }
  if (!row.education_year?.trim() && parsed.education_year) {
    updates.education_year = parsed.education_year;
    educationUpdated = true;
  }

  if (Object.keys(updates).length > 0) {
    updates.updated_at = new Date().toISOString();
    const { error } = await supabase.from("builder_profiles").update(updates).eq("id", row.id);
    if (error) {
      basicsUpdated = false;
      linksUpdated = false;
      educationUpdated = false;
    }
  }

  if (
    experienceImported === 0 &&
    projectsImported === 0 &&
    skipped === 0 &&
    !basicsUpdated &&
    !linksUpdated &&
    !educationUpdated
  ) {
    return { error: "Nothing new found on that site." };
  }

  revalidateProfile(row.token);
  return {
    success: true,
    experienceImported,
    projectsImported,
    skipped,
    basicsUpdated,
    linksUpdated,
    educationUpdated,
  };
}

// ============================================================
// Publish + share token
// ============================================================

export async function setProfilePublished(
  published: boolean
): Promise<{ success?: boolean; error?: string }> {
  const { profile, error: roleError } = await requireBuilder();
  if (!profile) return { error: roleError! };

  const row = await getOwnedProfile(profile.id);
  if (!row) return { error: "Profile not found." };

  const supabase = await getClient(profile.id);
  const { error } = await supabase
    .from("builder_profiles")
    .update({ is_published: published, updated_at: new Date().toISOString() })
    .eq("id", row.id);
  if (error) return { error: error.message };

  revalidateProfile(row.token);
  return { success: true };
}

export async function regenerateShareToken(): Promise<{
  success?: boolean;
  token?: string;
  error?: string;
}> {
  const { profile, error: roleError } = await requireBuilder();
  if (!profile) return { error: roleError! };

  const row = await getOwnedProfile(profile.id);
  if (!row) return { error: "Profile not found." };

  // supabase-js can't invoke the SQL column default on update, so mint the
  // same 64-hex shape here.
  const token = randomBytes(32).toString("hex");

  const supabase = await getClient(profile.id);
  const { error } = await supabase
    .from("builder_profiles")
    .update({ token, updated_at: new Date().toISOString() })
    .eq("id", row.id);
  if (error) return { error: error.message };

  revalidateProfile(row.token);
  revalidatePath(`/p/${token}`);
  return { success: true, token };
}
