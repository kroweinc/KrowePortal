"use server";

import { cookies } from "next/headers";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Engagement } from "@/lib/types";
import { PENDING_INVITE_COOKIE } from "@/lib/auth-shared";

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : await createClient();
}

// Creates an engagement for this builder (with backfill of existing personal tasks) if none exists.
// Uses admin client unconditionally — we've already verified the caller's identity via getCurrentProfile().
export async function getOrCreateEngagement(profileId: string): Promise<Engagement> {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("engagements")
    .select("*")
    .eq("builder_id", profileId)
    .maybeSingle();

  if (existing) return existing as Engagement;

  const { data: engagement, error } = await admin
    .from("engagements")
    .insert({ builder_id: profileId, title: "Shared space" })
    .select()
    .single();

  if (error || !engagement) throw new Error(error?.message ?? "Failed to create engagement");

  // Backfill existing personal tasks into the new engagement
  await admin
    .from("tasks")
    .update({ engagement_id: engagement.id })
    .eq("created_by", profileId)
    .is("engagement_id", null);

  return engagement as Engagement;
}

export async function createInvitation(): Promise<{ token: string } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders can create invitations." };

  let engagement: Engagement;
  try {
    engagement = await getOrCreateEngagement(profile.id);
  } catch (e) {
    return { error: (e as Error).message };
  }

  if (engagement.operator_id) {
    return { error: "You're already connected with an operator." };
  }

  const supabase = await getClient(profile.id);

  // Re-use an existing pending invite so the builder always shares one canonical link
  const { data: existingInvite } = await supabase
    .from("invitations")
    .select("token")
    .eq("engagement_id", engagement.id)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (existingInvite) return { token: existingInvite.token as string };

  // Mint a new invite — token is generated server-side by Postgres default
  const { data, error } = await supabase
    .from("invitations")
    .insert({ engagement_id: engagement.id, created_by: profile.id })
    .select("token")
    .single();

  if (error || !data) return { error: error?.message ?? "Failed to create invitation" };

  revalidatePath("/b");
  return { token: data.token as string };
}

export async function getMyEngagement(): Promise<Engagement | null> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "builder") return null;

  const supabase = await getClient(profile.id);
  const { data } = await supabase
    .from("engagements")
    .select("*, operator:profiles!operator_id(display_name)")
    .eq("builder_id", profile.id)
    .maybeSingle();

  return (data ?? null) as Engagement | null;
}

export async function getMyPendingInvite(): Promise<{ token: string; expires_at: string } | null> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "builder") return null;

  const supabase = await getClient(profile.id);

  const { data: engagement } = await supabase
    .from("engagements")
    .select("id")
    .eq("builder_id", profile.id)
    .maybeSingle();

  if (!engagement) return null;

  const { data } = await supabase
    .from("invitations")
    .select("token, expires_at")
    .eq("engagement_id", engagement.id)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  return data as { token: string; expires_at: string } | null;
}

const acceptSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/),
  displayName: z.string().min(1).max(80).optional(),
});

export async function acceptInvitation(
  token: string,
  displayName?: string
): Promise<{ success: true } | { error: string }> {
  const parsed = acceptSchema.safeParse({ token, displayName });
  if (!parsed.success) return { error: "Invalid invitation link." };

  // Confirm a valid session exists
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/join/${token}`);

  // All subsequent ops use admin client — the accepting user has no profile/engagement yet,
  // so RLS would block their reads. The migration comment confirms this is the intended design.
  const admin = createAdminClient();

  const { data: invitation, error: invErr } = await admin
    .from("invitations")
    .select("*, engagement:engagements(*)")
    .eq("token", parsed.data.token)
    .single();

  if (invErr || !invitation) return { error: "Invitation not found." };
  if (invitation.status === "accepted") return { error: "This invite has already been used." };
  if (invitation.status === "expired" || new Date(invitation.expires_at) < new Date()) {
    return { error: "This invite has expired. Ask the builder to send a new link." };
  }

  const engagement = invitation.engagement as {
    id: string;
    builder_id: string;
    operator_id: string | null;
  };

  if (engagement.operator_id) return { error: "This invite has already been used." };
  if (engagement.builder_id === user.id) return { error: "You can't accept your own invite." };

  const { data: existingProfile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (existingProfile?.role === "builder") {
    // Check whether they have a real builder engagement. If so, they're a
    // legitimate builder and we block the accept. If not, they were
    // auto-tagged (this bug) and we allow the promotion to operator.
    const { data: builderEngagement } = await admin
      .from("engagements")
      .select("id")
      .eq("builder_id", user.id)
      .maybeSingle();

    if (builderEngagement) {
      return { error: "You're already set up as a builder and can't join as an operator." };
    }
    // Fall through: stuck-builder recovery — upsert will overwrite to operator below
  }

  const name =
    parsed.data.displayName?.trim() ||
    (user.user_metadata?.full_name as string | undefined) ||
    "Operator";

  const { error: profileErr } = await admin.from("profiles").upsert({
    id: user.id,
    display_name: name,
    role: "operator",
  });
  if (profileErr) return { error: profileErr.message };

  const { error: engErr } = await admin
    .from("engagements")
    .update({ operator_id: user.id })
    .eq("id", engagement.id);
  if (engErr) return { error: engErr.message };

  await admin
    .from("invitations")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("id", invitation.id);

  // Clear the pending invite cookie now that it's been consumed
  try {
    const cookieStore = await cookies();
    cookieStore.set(PENDING_INVITE_COOKIE, "", { maxAge: 0, path: "/" });
  } catch {
    // Best-effort
  }

  return { success: true };
}
