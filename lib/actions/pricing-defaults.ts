"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PAYMENT_TERMS_PRESETS, DESIGN_SYSTEM_MODES } from "@/lib/types";
import { PRICING_DEFAULTS_FALLBACK, type PricingDefaults } from "@/lib/quote/defaults";

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : await createClient();
}

/**
 * The builder's pricing defaults for seeding new quotes. Reads a single
 * builder_profiles row and falls back to PRICING_DEFAULTS_FALLBACK when there's
 * no row yet (e.g. the dev builder). Takes profileId so draftQuote can pass its
 * already-resolved profile — far lighter than getOrCreateBuilderProfile, which
 * also fetches projects/experience/tools and signs an avatar URL.
 */
export async function getPricingDefaults(profileId: string): Promise<PricingDefaults> {
  const supabase = await getClient(profileId);
  const { data } = await supabase
    .from("builder_profiles")
    .select("default_hourly_rate, payment_terms_preset, design_system_mode, design_fixed_cost")
    .eq("user_id", profileId)
    .maybeSingle();

  if (!data) return PRICING_DEFAULTS_FALLBACK;
  return {
    hourlyRate: data.default_hourly_rate ?? PRICING_DEFAULTS_FALLBACK.hourlyRate,
    paymentTermsPreset: data.payment_terms_preset ?? PRICING_DEFAULTS_FALLBACK.paymentTermsPreset,
    designSystemMode: data.design_system_mode ?? PRICING_DEFAULTS_FALLBACK.designSystemMode,
    designFixedCost: data.design_fixed_cost ?? PRICING_DEFAULTS_FALLBACK.designFixedCost,
  };
}

const updateSchema = z.object({
  hourlyRate: z.number().int().min(0).max(100000),
  paymentTermsPreset: z.enum(PAYMENT_TERMS_PRESETS),
  designSystemMode: z.enum(DESIGN_SYSTEM_MODES),
  designFixedCost: z.number().int().min(0).max(1000000),
});

export type UpdatePricingDefaultsInput = z.input<typeof updateSchema>;

/** Persist the builder's quote pricing defaults. Bootstraps the builder_profiles
    row if it doesn't exist yet (upsert on the unique user_id). Builder-only. */
export async function updatePricingDefaults(
  input: UpdatePricingDefaultsInput
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders can set quote defaults." };

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const supabase = await getClient(profile.id);
  const { error } = await supabase.from("builder_profiles").upsert(
    {
      user_id: profile.id,
      default_hourly_rate: parsed.data.hourlyRate,
      payment_terms_preset: parsed.data.paymentTermsPreset,
      design_system_mode: parsed.data.designSystemMode,
      design_fixed_cost: parsed.data.designFixedCost,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) return { error: error.message };

  revalidatePath("/b/settings/quotes");
  return { success: true };
}
