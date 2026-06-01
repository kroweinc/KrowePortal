"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { groupQuoteIntoMilestones } from "@/lib/ai/generate-milestones";
import type { Brief, BriefContent } from "@/lib/types";

const TOKEN_RE = /^[a-f0-9]{64}$/;

export interface PublicQuote {
  brief: Brief;
  builderName: string;
  clientName: string | null;
}

// Public, no-auth lookup of a quote by its token. Uses the admin client
// because the visitor may have no profile/session — the token is the
// capability. Returns null for malformed tokens or missing rows.
export async function getQuoteByToken(token: string): Promise<PublicQuote | null> {
  if (!TOKEN_RE.test(token)) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("briefs")
    .select(
      "*, engagement:engagements(title, builder:profiles!builder_id(display_name)), project:projects(name, owner:profiles!owner_id(display_name))"
    )
    .eq("token", token)
    .maybeSingle();

  if (!data) return null;

  // A quote hangs off either an engagement (legacy/inbound) or a project
  // (outbound). Resolve the builder name and client name from whichever
  // parent is present.
  const row = data as Record<string, unknown> & {
    engagement?: { builder?: { display_name?: string | null } | null } | null;
    project?: { name?: string | null; owner?: { display_name?: string | null } | null } | null;
  };
  const builderName =
    row.engagement?.builder?.display_name ?? row.project?.owner?.display_name ?? "Your builder";
  const clientName = row.project?.name ?? null;

  const { engagement: _e, project: _p, ...briefRow } = row;
  const brief = briefRow as unknown as Brief;

  return { brief, builderName, clientName };
}

// The atomic sign + provision entrypoint, callable from the public
// (no-account) quote page. Validates input, groups the quote into
// milestones (AI), then runs the provisioning RPC in one transaction.
export async function signQuote(
  token: string,
  input: { signerName: string; consent: boolean }
): Promise<{ success: true } | { error: string }> {
  if (!TOKEN_RE.test(token)) return { error: "Invalid quote link." };

  const signerName = input.signerName?.trim() ?? "";
  if (signerName.length < 2) return { error: "Please type your full name to sign." };
  if (signerName.length > 200) return { error: "Name is too long." };
  if (!input.consent) return { error: "You must agree to the terms to sign." };

  const admin = createAdminClient();

  const { data: brief } = await admin
    .from("briefs")
    .select("id, status, content, engagement_id, project_id")
    .eq("token", token)
    .maybeSingle();

  if (!brief) return { error: "Quote not found." };
  if (brief.status !== "sent") return { error: "This quote is not awaiting signature." };

  // Capture signer IP for the audit trail.
  const hdr = await headers();
  const signerIp =
    (hdr.get("x-forwarded-for")?.split(",")[0] ?? hdr.get("x-real-ip") ?? "").trim() || null;

  // OUTBOUND quote (project-backed, no engagement): there is nothing to
  // provision into — just stamp the signature directly. No milestones AI,
  // no provisioning RPC. The status guard prevents a double-sign race.
  if (brief.project_id && !brief.engagement_id) {
    const now = new Date().toISOString();
    const { error: stampErr } = await admin
      .from("briefs")
      .update({
        status: "signed",
        signed_at: now,
        signed_by_name: signerName,
        signer_ip: signerIp,
        signature_consent: true,
        updated_at: now,
      })
      .eq("token", token)
      .eq("status", "sent");
    if (stampErr) return { error: stampErr.message };

    await admin.from("projects").update({ status: "won", updated_at: now }).eq("id", brief.project_id);

    revalidatePath(`/b/projects/${brief.project_id as string}`);
    revalidatePath(`/b/projects/${brief.project_id as string}/quote/${brief.id as string}`);
    revalidatePath(`/quote/${token}`);
    return { success: true };
  }

  // LEGACY engagement quote: full sign-and-provision path below.
  // If a signed-in operator is the one signing, attach them to the engagement.
  let operatorId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: prof } = await admin
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      if (prof?.role === "operator") operatorId = user.id;
    }
  } catch {
    operatorId = null;
  }

  // Group the quote into milestones BEFORE the transaction (AI can't run in plpgsql).
  const milestones = await groupQuoteIntoMilestones(brief.content as BriefContent);
  const payload = milestones.map((m, i) => ({
    title: m.title,
    description: m.description,
    amount: m.amount,
    sort_order: i,
    tasks: m.tasks,
  }));

  const { error } = await admin.rpc("sign_and_provision_quote", {
    p_token: token,
    p_signer_name: signerName,
    p_signer_ip: signerIp,
    p_operator_id: operatorId,
    p_milestones: payload,
  });

  if (error) return { error: error.message };

  revalidatePath("/o/project");
  revalidatePath("/o");
  revalidatePath(`/b/brief/${brief.id as string}`);
  return { success: true };
}
