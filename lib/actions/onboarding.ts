"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { createProject } from "@/lib/actions/projects";
import { createInvitation } from "@/lib/actions/invitations";
import type { Engagement, OnboardingState, OnboardingStatus } from "@/lib/types";

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : await createClient();
}

// Shallow-merges a patch into the signed-in builder's onboarding jsonb.
export async function saveOnboardingProgress(
  patch: OnboardingState
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders have onboarding." };

  const supabase = await getClient(profile.id);
  const { error } = await supabase
    .from("profiles")
    .update({ onboarding: { ...profile.onboarding, ...patch } })
    .eq("id", profile.id);

  if (error) return { error: error.message };
  return { success: true };
}

const stepSchema = z.enum(["path", "prospect", "handoff", "client", "repo", "tasks", "docs"]);

// Skip/path-selection helper: advances the wizard step without doing any work.
export async function advanceOnboarding(
  step: z.infer<typeof stepSchema>,
  path?: "no_clients" | "has_clients"
): Promise<{ success: true } | { error: string }> {
  const parsed = stepSchema.safeParse(step);
  if (!parsed.success) return { error: "Invalid step." };
  return saveOnboardingProgress(path ? { step: parsed.data, path } : { step: parsed.data });
}

/**
 * Path 1 (no clients): creates the prospect's project and advances to the
 * handoff step in one round trip. Document creation continues in the existing
 * pipeline (/b/projects/[id]).
 */
export async function createProspectProject(input: {
  name: string;
  prospectName?: string;
  prospectEmail?: string;
  websiteUrl?: string;
}): Promise<{ projectId: string } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders can create documents." };

  // Resume guard: reuse the project from a previous wizard attempt — but only if
  // it still exists and is owned by this builder. A stale project_id (the project
  // was deleted, or it was left behind in the onboarding jsonb when switching
  // paths) must fall through to a fresh create, never trap the wizard on this
  // step. Mirrors createClientEngagement, which validates its resume entity too.
  const existingId = profile.onboarding?.project_id;
  if (existingId) {
    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("projects")
      .select("id")
      .eq("id", existingId)
      .eq("owner_id", profile.id)
      .maybeSingle();
    if (existing) {
      // Always advance the step — otherwise a resubmit returns "success" while
      // the wizard stays on "prospect" forever.
      await saveOnboardingProgress({ step: "handoff" });
      return { projectId: existing.id as string };
    }
  }

  const project = await createProject(input);
  if ("error" in project) return { error: project.error };

  await saveOnboardingProgress({ project_id: project.id, step: "handoff" });
  return { projectId: project.id };
}

const clientSchema = z.object({
  clientName: z.string().trim().min(1, "Enter your client's name.").max(120),
  clientEmail: z.string().email("Enter a valid email.").max(320).optional().or(z.literal("")),
});

export type ClientEngagementResult =
  | { engagementId: string; projectId: string | null; inviteToken: string | null }
  | { error: string };

/**
 * Path 2 (has clients): creates a backing project named after the client, a
 * fresh engagement linked to it, and an invite token — in one step. Re-running
 * (refresh/resume) returns the existing engagement instead of duplicating.
 * Deliberately NOT getOrCreateEngagement(), which grabs the oldest engagement
 * and backfills personal tasks.
 */
export async function createClientEngagement(input: {
  clientName: string;
  clientEmail?: string;
}): Promise<ClientEngagementResult> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders can create engagements." };

  const admin = createAdminClient();

  // Resume guard: an engagement from a previous wizard attempt is reused.
  if (profile.onboarding?.engagement_id) {
    const { data: existing } = await admin
      .from("engagements")
      .select("*")
      .eq("id", profile.onboarding.engagement_id)
      .eq("builder_id", profile.id)
      .maybeSingle();
    if (existing) {
      const engagement = existing as Engagement;
      let inviteToken: string | null = null;
      if (!engagement.operator_id) {
        const invite = await createInvitation(engagement.id);
        if ("token" in invite) inviteToken = invite.token;
      }
      return {
        engagementId: engagement.id,
        projectId: engagement.project_id ?? null,
        inviteToken,
      };
    }
  }

  const parsed = clientSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const clientName = parsed.data.clientName;

  // Backing project so a PRD/quote/contract can be attached to this client later.
  const project = await createProject({
    name: clientName,
    prospectName: clientName,
    prospectEmail: parsed.data.clientEmail || undefined,
  });
  if ("error" in project) return { error: project.error };

  const { data: engagement, error: engErr } = await admin
    .from("engagements")
    .insert({ builder_id: profile.id, title: clientName, project_id: project.id })
    .select()
    .single();

  if (engErr || !engagement) {
    // 23505 = engagements_project_unique race (double submit)
    if (engErr?.code === "23505") {
      const { data: raced } = await admin
        .from("engagements")
        .select("*")
        .eq("project_id", project.id)
        .eq("builder_id", profile.id)
        .maybeSingle();
      if (raced) {
        return { engagementId: raced.id as string, projectId: project.id, inviteToken: null };
      }
    }
    return { error: engErr?.message ?? "Failed to create engagement." };
  }

  let inviteToken: string | null = null;
  const invite = await createInvitation(engagement.id as string);
  if ("token" in invite) inviteToken = invite.token;

  await saveOnboardingProgress({
    engagement_id: engagement.id as string,
    project_id: project.id,
    step: "repo",
  });

  revalidatePath("/b/engagements");
  revalidatePath("/b");

  return { engagementId: engagement.id as string, projectId: project.id, inviteToken };
}

// Terminal for both paths: 'completed' (finished/handoff) or 'dismissed' (skip-all).
export async function finishOnboarding(
  status: Extract<OnboardingStatus, "completed" | "dismissed">
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders have onboarding." };

  const supabase = await getClient(profile.id);
  const { error } = await supabase
    .from("profiles")
    .update({
      onboarding_status: status,
      onboarding: { ...profile.onboarding, completed_at: new Date().toISOString() },
    })
    .eq("id", profile.id);

  if (error) return { error: error.message };

  revalidatePath("/b");
  return { success: true };
}
