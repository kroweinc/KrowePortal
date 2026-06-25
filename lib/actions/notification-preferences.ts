"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { NotificationPreferences } from "@/lib/types";

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : await createClient();
}

/** The editable preference flags (everything on NotificationPreferences except
    the identity/timestamp columns). Defaults are all-on, matching the migration
    column defaults and the dispatcher's default-on behaviour. */
export interface NotificationPreferenceFlags {
  notify_doc_signed: boolean;
  notify_change_order: boolean;
  notify_invite_accepted: boolean;
}

// Module-private: a "use server" file may only export async functions, so this
// stays internal (the dispatcher and DB defaults already encode all-on).
const NOTIFICATION_PREFERENCE_DEFAULTS: NotificationPreferenceFlags = {
  notify_doc_signed: true,
  notify_change_order: true,
  notify_invite_accepted: true,
};

/** Read the signed-in user's notification flags. Falls back to all-on when no
    row exists yet (the common case — a row is only written on first change). */
export async function getNotificationPreferences(): Promise<NotificationPreferenceFlags> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await getClient(profile.id);
  const { data } = await supabase
    .from("notification_preferences")
    .select("notify_doc_signed, notify_change_order, notify_invite_accepted")
    .eq("user_id", profile.id)
    .maybeSingle();

  if (!data) return { ...NOTIFICATION_PREFERENCE_DEFAULTS };
  return {
    notify_doc_signed: (data as NotificationPreferences).notify_doc_signed ?? true,
    notify_change_order: (data as NotificationPreferences).notify_change_order ?? true,
    notify_invite_accepted: (data as NotificationPreferences).notify_invite_accepted ?? true,
  };
}

const updateSchema = z.object({
  notify_doc_signed: z.boolean(),
  notify_change_order: z.boolean(),
  notify_invite_accepted: z.boolean(),
});

/** Persist the signed-in user's notification flags. Upserts on user_id, so the
    first save creates the row. Available to both roles. */
export async function updateNotificationPreferences(
  input: NotificationPreferenceFlags
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid notification settings." };

  const supabase = await getClient(profile.id);
  const { error } = await supabase.from("notification_preferences").upsert(
    {
      user_id: profile.id,
      ...parsed.data,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) return { error: error.message };

  revalidatePath("/b/settings/notifications");
  revalidatePath("/o/settings/notifications");
  return { success: true };
}
