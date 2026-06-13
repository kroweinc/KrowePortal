"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const onboardingSchema = z.object({
  display_name: z.string().min(1).max(80),
  role: z.enum(["operator", "builder"]),
});

export async function completeOnboarding(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const parsed = onboardingSchema.safeParse({
    display_name: formData.get("display_name"),
    role: formData.get("role"),
  });

  if (!parsed.success) {
    return { error: "Invalid input" };
  }

  // Builders enter the onboarding wizard (the /onboarding page re-renders at
  // the persisted step); operators skip it entirely — the column default
  // already marks them 'completed' on insert.
  const isBuilder = parsed.data.role === "builder";
  const { error } = await supabase.from("profiles").upsert({
    id: user.id,
    display_name: parsed.data.display_name,
    role: parsed.data.role,
    ...(isBuilder
      ? { onboarding_status: "in_progress", onboarding: { step: "path" } }
      : {}),
  });

  if (error) return { error: error.message };

  if (!isBuilder) redirect("/o");
  return { success: true };
}

const updateProfileSchema = z.object({
  display_name: z.string().trim().min(1).max(80),
});

/** Update the signed-in user's editable profile fields (currently just the
    display name). Mirrors the engagement actions: DEV ids use the admin client,
    everyone else the request-scoped client under RLS. */
export async function updateProfile(input: {
  display_name: string;
}): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = updateProfileSchema.safeParse(input);
  if (!parsed.success) return { error: "Display name must be 1–80 characters." };

  const supabase = DEV_PROFILE_IDS.has(profile.id)
    ? createAdminClient()
    : await createClient();

  const { error } = await supabase
    .from("profiles")
    .update({ display_name: parsed.data.display_name })
    .eq("id", profile.id);

  if (error) return { error: error.message };

  revalidatePath("/b/settings");
  revalidatePath("/b", "layout"); // Nav (components/nav.tsx) renders display_name
  return { success: true };
}
