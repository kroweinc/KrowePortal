"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import type { TourStatus } from "@/lib/types";

/**
 * Records the builder's terminal product-tour state so it never auto-starts
 * again. Mirrors finishOnboarding() in lib/actions/onboarding.ts — dev profiles
 * (DEV_PROFILE_IDS) have no real DB row, so the admin update is a harmless no-op.
 */
export async function setTourStatus(
  status: Extract<TourStatus, "completed" | "dismissed">
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders have the tour." };

  const supabase = DEV_PROFILE_IDS.has(profile.id)
    ? createAdminClient()
    : await createClient();

  const { error } = await supabase
    .from("profiles")
    .update({ tour_status: status })
    .eq("id", profile.id);

  if (error) return { error: error.message };

  revalidatePath("/b");
  return { success: true };
}
