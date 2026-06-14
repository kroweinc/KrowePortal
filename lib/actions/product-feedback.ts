"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { sendFeedbackNotification } from "@/lib/email/feedback-notification";

// Dev profiles have no real auth session, so they use the admin (RLS-bypass)
// client — mirrors the helper in lib/actions/project-sop.ts.
async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : await createClient();
}

const schema = z.object({
  category: z.enum(["bug", "idea", "other"]),
  rating: z.number().int().min(1).max(5).nullable(),
  message: z.string().trim().min(1, "Tell us a bit more.").max(2000, "Message is too long."),
  pagePath: z.string().trim().max(300).optional(),
});

export type SubmitFeedbackInput = z.input<typeof schema>;

export async function submitFeedback(
  input: SubmitFeedbackInput
): Promise<{ success?: boolean; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const supabase = await getClient(profile.id);
  const { error } = await supabase.from("product_feedback").insert({
    user_id: profile.id,
    user_role: profile.role, // server-trusted, not from the client
    category: parsed.data.category,
    rating: parsed.data.rating,
    message: parsed.data.message,
    page_path: parsed.data.pagePath ?? null,
  });

  if (error) return { error: error.message };

  // Notify the Krowe team out-of-band: after() runs once the response is sent, so
  // the user never waits on Resend, and sendFeedbackNotification never throws — an
  // email failure can't undo the already-saved feedback.
  after(() =>
    sendFeedbackNotification({
      submitterName: profile.display_name ?? `Anonymous ${profile.role}`,
      role: profile.role,
      category: parsed.data.category,
      rating: parsed.data.rating,
      message: parsed.data.message,
      pagePath: parsed.data.pagePath ?? null,
    })
  );

  // No revalidatePath — there is no in-app list view yet (DB-only slice).
  return { success: true };
}
