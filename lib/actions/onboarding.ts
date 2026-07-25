"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { createProject } from "@/lib/actions/projects";
import { createInvitation } from "@/lib/actions/invitations";
import {
  AGENCY_TYPES,
  AGENCY_SIZES,
  PRICING_MODELS,
  type Engagement,
  type OnboardingState,
  type OnboardingStatus,
} from "@/lib/types";

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : await createClient();
}

// Upsert a patch onto the signed-in builder's builder_profiles row (bootstrapped
// at signup). Mirrors updatePricingDefaults — onConflict on the unique user_id.
async function patchBuilderProfile(
  profileId: string,
  patch: Record<string, unknown>
): Promise<{ error?: string }> {
  const supabase = await getClient(profileId);
  const { error } = await supabase
    .from("builder_profiles")
    .upsert(
      { user_id: profileId, ...patch, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  return error ? { error: error.message } : {};
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

const stepSchema = z.enum(["identity", "agency_type", "agency_size", "client", "charging"]);

// Skip helper: advances the wizard step without doing any work.
export async function advanceOnboarding(
  step: z.infer<typeof stepSchema>
): Promise<{ success: true } | { error: string }> {
  const parsed = stepSchema.safeParse(step);
  if (!parsed.success) return { error: "Invalid step." };
  return saveOnboardingProgress({ step: parsed.data });
}

const identitySchema = z.object({
  displayName: z.string().trim().min(1, "Enter your name.").max(80).optional().or(z.literal("")),
  agencyName: z.string().trim().max(120).optional().or(z.literal("")),
  agencyRole: z.string().trim().max(120).optional().or(z.literal("")),
});

/**
 * Identity step: saves the builder's display name (if changed) plus their agency
 * name and role, then advances to the agency-type step. Avatar upload is handled
 * separately (uploadAvatar) against the row bootstrapped at signup.
 */
export async function saveAgencyIdentity(input: {
  displayName?: string;
  agencyName?: string;
  agencyRole?: string;
}): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders have onboarding." };

  const parsed = identitySchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const supabase = await getClient(profile.id);
  const name = (parsed.data.displayName ?? "").trim();
  if (name && name !== profile.display_name) {
    const { error } = await supabase.from("profiles").update({ display_name: name }).eq("id", profile.id);
    if (error) return { error: error.message };
  }

  const saved = await patchBuilderProfile(profile.id, {
    agency_name: (parsed.data.agencyName ?? "").trim() || null,
    agency_role: (parsed.data.agencyRole ?? "").trim() || null,
  });
  if (saved.error) return { error: saved.error };

  return saveOnboardingProgress({ step: "agency_type" });
}

/** Agency-type step: persists the discipline and advances to size. */
export async function saveAgencyType(
  type: (typeof AGENCY_TYPES)[number]
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders have onboarding." };
  if (!AGENCY_TYPES.includes(type)) return { error: "Invalid agency type." };

  const saved = await patchBuilderProfile(profile.id, { agency_type: type });
  if (saved.error) return { error: saved.error };
  return saveOnboardingProgress({ step: "agency_size" });
}

/** Agency-size step: persists the size band and advances to the client step. */
export async function saveAgencySize(
  size: (typeof AGENCY_SIZES)[number]
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders have onboarding." };
  if (!AGENCY_SIZES.includes(size)) return { error: "Invalid agency size." };

  const saved = await patchBuilderProfile(profile.id, { agency_size: size });
  if (saved.error) return { error: saved.error };
  return saveOnboardingProgress({ step: "client" });
}

const chargingSchema = z.object({
  pricingModel: z.enum(PRICING_MODELS),
  hourlyRate: z.number().int().min(0).max(100000),
});

/**
 * Final step: saves how the builder charges — the pricing model plus a typical
 * rate that seeds default_hourly_rate (0058) so new quotes prefill from it — and
 * completes onboarding. The caller redirects to /b afterward.
 */
export async function saveCharging(input: {
  pricingModel: (typeof PRICING_MODELS)[number];
  hourlyRate: number;
}): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders have onboarding." };

  const parsed = chargingSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const saved = await patchBuilderProfile(profile.id, {
    pricing_model: parsed.data.pricingModel,
    default_hourly_rate: parsed.data.hourlyRate,
  });
  if (saved.error) return { error: saved.error };

  return finishOnboarding("completed");
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
  if (profile.role !== "builder") return { error: "Only builders can create clients." };

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
    // Builder is deliberately setting up a client engagement — live from creation.
    .insert({
      builder_id: profile.id,
      title: clientName,
      project_id: project.id,
      started_at: new Date().toISOString(),
    })
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
    return { error: engErr?.message ?? "Failed to create client." };
  }

  let inviteToken: string | null = null;
  const invite = await createInvitation(engagement.id as string);
  if ("token" in invite) inviteToken = invite.token;

  await saveOnboardingProgress({
    engagement_id: engagement.id as string,
    project_id: project.id,
    step: "charging",
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
