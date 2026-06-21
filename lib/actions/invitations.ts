"use server";

import { cookies } from "next/headers";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { notifyUser, inviteAcceptedEmail } from "@/lib/email/notify";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Engagement } from "@/lib/types";
import { PENDING_INVITE_COOKIE } from "@/lib/auth-shared";

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : await createClient();
}

// Creates an engagement for this builder (with backfill of existing personal tasks) if none exists.
// Uses admin client unconditionally and trusts the caller-supplied profileId, so this MUST stay a
// module-internal helper — never export it. Exporting it from a "use server" file would expose it as
// an unauthenticated RPC endpoint that any client could call with an arbitrary profile id (IDOR).
// Its only caller, createInvitation below, derives the id from getCurrentProfile() first.
async function getOrCreateEngagement(profileId: string): Promise<Engagement> {
  const admin = createAdminClient();

  const { data: existingRows } = await admin
    .from("engagements")
    .select("*")
    .eq("builder_id", profileId)
    .order("created_at", { ascending: true })
    .limit(1);

  const existing = existingRows?.[0];
  if (existing) return existing as Engagement;

  const { data: engagement, error } = await admin
    .from("engagements")
    // Standalone personal workspace — live from creation, no project pipeline.
    .insert({ builder_id: profileId, title: "Shared space", started_at: new Date().toISOString() })
    .select()
    .single();

  if (error || !engagement) throw new Error(error?.message ?? "Failed to create client");

  // Backfill existing personal tasks into the new engagement
  await admin
    .from("tasks")
    .update({ engagement_id: engagement.id })
    .eq("created_by", profileId)
    .is("engagement_id", null);

  return engagement as Engagement;
}

const createEngagementSchema = z.object({ title: z.string().min(1).max(120) });

// Creates an additional engagement for this builder (no task backfill — that only
// happens for the very first engagement via getOrCreateEngagement).
export async function createEngagement(
  title: string
): Promise<{ engagement: Engagement } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders can create clients." };

  const parsed = createEngagementSchema.safeParse({ title });
  if (!parsed.success) return { error: "Client name must be 1–120 characters." };

  const admin = createAdminClient();
  const { data: engagement, error } = await admin
    .from("engagements")
    // Builder explicitly created this engagement — live from creation.
    .insert({ builder_id: profile.id, title: parsed.data.title.trim(), started_at: new Date().toISOString() })
    .select()
    .single();

  if (error || !engagement) return { error: error?.message ?? "Failed to create client" };

  revalidatePath("/b/engagements");
  revalidatePath("/b");
  return { engagement: engagement as Engagement };
}

export async function createInvitation(
  engagementId?: string
): Promise<{ token: string } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders can create invitations." };

  let engagement: Engagement;
  if (engagementId) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("engagements")
      .select("*")
      .eq("id", engagementId)
      .eq("builder_id", profile.id)
      .maybeSingle();
    if (!data) return { error: "Client not found." };
    engagement = data as Engagement;
  } else {
    try {
      engagement = await getOrCreateEngagement(profile.id);
    } catch (e) {
      return { error: (e as Error).message };
    }
  }

  if (engagement.operator_id) {
    return { error: "This client already has an operator." };
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
  revalidatePath("/b/engagements");
  return { token: data.token as string };
}

// Fetches an engagement only if it belongs to this builder. Admin client + explicit
// builder_id filter — engagements has no UPDATE/DELETE RLS policies, so all owner
// mutations go through this app-level ownership check (same as createInvitation).
async function getOwnedEngagement(
  engagementId: string,
  builderId: string
): Promise<Engagement | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("engagements")
    .select("*")
    .eq("id", engagementId)
    .eq("builder_id", builderId)
    .maybeSingle();
  return (data ?? null) as Engagement | null;
}

export async function renameEngagement(
  engagementId: string,
  title: string
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders can rename clients." };

  const parsed = createEngagementSchema.safeParse({ title });
  if (!parsed.success) return { error: "Client name must be 1–120 characters." };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("engagements")
    .update({ title: parsed.data.title.trim() })
    .eq("id", engagementId)
    .eq("builder_id", profile.id)
    .select()
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data) return { error: "Client not found." };

  revalidatePath("/b");
  revalidatePath("/b/engagements");
  revalidatePath(`/b/engagements/${engagementId}`);
  return { success: true };
}

// Detaches the operator from the engagement so a new one can be invited. Their
// authored rows (tasks, deliverables, materials) reference profiles, not the
// engagement role, so the data stays — they only lose RLS access.
export async function removeOperator(
  engagementId: string
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders can remove operators." };

  const engagement = await getOwnedEngagement(engagementId, profile.id);
  if (!engagement) return { error: "Client not found." };
  if (!engagement.operator_id) return { error: "This client has no operator." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("engagements")
    .update({ operator_id: null })
    .eq("id", engagementId)
    .eq("builder_id", profile.id);

  if (error) return { error: error.message };

  revalidatePath("/b");
  revalidatePath("/b/engagements");
  revalidatePath(`/b/engagements/${engagementId}`);
  revalidatePath("/o/project");
  return { success: true };
}

// Expires any pending invite for the engagement. Status flip (not delete) keeps the
// audit trail; acceptInvitation rejects expired invites, and createInvitation's
// reuse query ignores them so the next create mints a fresh token.
export async function revokeInvitation(
  engagementId: string
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders can revoke invitations." };

  const engagement = await getOwnedEngagement(engagementId, profile.id);
  if (!engagement) return { error: "Client not found." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("invitations")
    .update({ status: "expired" })
    .eq("engagement_id", engagementId)
    .eq("status", "pending");

  if (error) return { error: error.message };

  revalidatePath("/b");
  revalidatePath("/b/engagements");
  revalidatePath(`/b/engagements/${engagementId}`);
  return { success: true };
}

export async function deleteEngagement(
  engagementId: string
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders can delete clients." };

  const engagement = await getOwnedEngagement(engagementId, profile.id);
  if (!engagement) return { error: "Client not found." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("engagements")
    .delete()
    .eq("id", engagementId)
    .eq("builder_id", profile.id);

  if (error) return { error: error.message };

  revalidatePath("/b");
  revalidatePath("/b/engagements");
  return { success: true };
}

export async function getMyEngagements(): Promise<Engagement[]> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "builder") return [];

  // Admin client: the operator embed reads the operator's profile row, which
  // profiles_select RLS ("auth.uid() = id") forbids the builder from seeing —
  // under the RLS client that embed silently returns null and the UI shows
  // "No operator yet" even after the operator joins. Ownership is enforced by
  // the explicit builder_id filter below (same pattern as getOwnedEngagement).
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("engagements")
    .select(
      "*, operator:profiles!operator_id(display_name), project:projects(id, name, prospect_name, prospect_email, website_url, linkedin_url, live_url, context)"
    )
    .eq("builder_id", profile.id)
    // Only live engagements — exclude shells created when an operator accepted
    // a doc but the build hasn't begun (see migration 0057).
    .not("started_at", "is", null)
    .order("created_at", { ascending: true });

  return (data ?? []) as Engagement[];
}

export type PendingInvite = { token: string; expires_at: string };

// Pending (unexpired) invites for all of the builder's engagements, keyed by engagement_id.
export async function getMyPendingInvites(): Promise<Record<string, PendingInvite>> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "builder") return {};

  const supabase = await getClient(profile.id);

  const { data: engagements } = await supabase
    .from("engagements")
    .select("id")
    .eq("builder_id", profile.id);

  const ids = (engagements ?? []).map((e) => e.id as string);
  if (ids.length === 0) return {};

  const { data } = await supabase
    .from("invitations")
    .select("engagement_id, token, expires_at")
    .in("engagement_id", ids)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString());

  const map: Record<string, PendingInvite> = {};
  for (const row of data ?? []) {
    map[row.engagement_id as string] = {
      token: row.token as string,
      expires_at: row.expires_at as string,
    };
  }
  return map;
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
    title: string;
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
    const { data: builderEngagements } = await admin
      .from("engagements")
      .select("id")
      .eq("builder_id", user.id)
      .limit(1);

    if ((builderEngagements?.length ?? 0) > 0) {
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

  // Notify the builder their invite was accepted — fire-and-forget.
  const inviteEmail = inviteAcceptedEmail({
    operatorName: name,
    engagementTitle: engagement.title ?? "your client",
    engagementId: engagement.id,
  });
  void notifyUser({ userId: engagement.builder_id, type: "invite_accepted", ...inviteEmail });

  // Clear the pending invite cookie now that it's been consumed
  try {
    const cookieStore = await cookies();
    cookieStore.set(PENDING_INVITE_COOKIE, "", { maxAge: 0, path: "/" });
  } catch {
    // Best-effort
  }

  return { success: true };
}
