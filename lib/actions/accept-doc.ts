"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import type { Engagement } from "@/lib/types";

const TOKEN_RE = /^[a-f0-9]{64}$/;

export interface AcceptInput {
  signerName: string;
  consent: boolean;
}

export type AcceptResult = { success: true; redirectTo: string } | { error: string };

type ProjectRef = { id: string; owner_id: string; name: string | null };

async function clientIp(): Promise<string | null> {
  const hdr = await headers();
  return (hdr.get("x-forwarded-for")?.split(",")[0] ?? hdr.get("x-real-ip") ?? "").trim() || null;
}

/**
 * Ensures the accepting user is set up as the operator on the project's
 * engagement: upserts an operator profile (with stuck-builder guard, mirroring
 * acceptInvitation) and find-or-creates the engagement, linking operator_id.
 * Admin client throughout — the caller has already verified the auth user and
 * that they are not the project owner.
 */
async function linkOperatorToProject(
  admin: SupabaseClient,
  user: User,
  project: ProjectRef,
  displayName: string
): Promise<{ engagement: Engagement } | { error: string }> {
  const { data: existingProfile } = await admin
    .from("profiles")
    .select("role, display_name")
    .eq("id", user.id)
    .maybeSingle();

  if (existingProfile?.role === "builder") {
    // A real builder (has at least one builder engagement) can't switch to
    // operator. A profile-less/stuck builder falls through to promotion.
    const { data: builderEngagements } = await admin
      .from("engagements")
      .select("id")
      .eq("builder_id", user.id)
      .limit(1);
    if ((builderEngagements?.length ?? 0) > 0) {
      return { error: "You're set up as a builder and can't accept this as an operator." };
    }
  }

  const name =
    displayName.trim() ||
    (existingProfile?.display_name as string | undefined) ||
    (user.user_metadata?.full_name as string | undefined) ||
    "Operator";

  const { error: profileErr } = await admin
    .from("profiles")
    .upsert({ id: user.id, display_name: name, role: "operator" });
  if (profileErr) return { error: profileErr.message };

  // Find-or-create the engagement for this project. The builder's
  // beginEngagement may have created it already; if not, we create the shell
  // here so the operator gets portal access regardless of ordering.
  let { data: engagement } = await admin
    .from("engagements")
    .select("*")
    .eq("project_id", project.id)
    .maybeSingle();

  if (!engagement) {
    const { data: created, error: createErr } = await admin
      .from("engagements")
      .insert({
        builder_id: project.owner_id,
        project_id: project.id,
        title: project.name ?? "Client",
        operator_id: user.id,
      })
      .select()
      .single();
    if (createErr || !created) {
      // Lost a create race on the project-unique index — re-read.
      ({ data: engagement } = await admin
        .from("engagements")
        .select("*")
        .eq("project_id", project.id)
        .maybeSingle());
      if (!engagement) return { error: createErr?.message ?? "Could not start the client." };
    } else {
      return { engagement: created as Engagement };
    }
  }

  const eng = engagement as Engagement;
  if (eng.operator_id && eng.operator_id !== user.id) {
    return { error: "This project already has an operator." };
  }
  if (!eng.operator_id) {
    const { error: linkErr } = await admin
      .from("engagements")
      .update({ operator_id: user.id })
      .eq("id", eng.id);
    if (linkErr) return { error: linkErr.message };
    eng.operator_id = user.id;
  }
  return { engagement: eng };
}

// Shared preamble: validate, resolve the auth user, load the doc + project,
// and link the operator. Returns the engagement + signer name on success.
async function prepareAccept(
  table: "quotes" | "contracts" | "prds",
  token: string,
  input: AcceptInput
): Promise<
  | { ok: true; admin: SupabaseClient; user: User; project: ProjectRef; engagement: Engagement; signerName: string; docId: string; projectId: string }
  | { ok: false; error: string }
> {
  if (!TOKEN_RE.test(token)) return { ok: false, error: "Invalid link." };
  const signerName = input.signerName?.trim() ?? "";
  if (signerName.length < 2) return { ok: false, error: "Please type your full name to accept." };
  if (signerName.length > 200) return { ok: false, error: "Name is too long." };
  if (!input.consent) return { ok: false, error: "You must agree to the terms to accept." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Please create an account to accept." };

  const admin = createAdminClient();
  const { data: doc } = await admin
    .from(table)
    .select("id, status, project_id")
    .eq("token", token)
    .maybeSingle();
  if (!doc) return { ok: false, error: "This document was not found." };
  if (doc.status !== "sent") return { ok: false, error: "This document is not awaiting acceptance." };

  const { data: project } = await admin
    .from("projects")
    .select("id, owner_id, name")
    .eq("id", doc.project_id as string)
    .maybeSingle();
  if (!project) return { ok: false, error: "Document not found." };
  if (project.owner_id === user.id) {
    return { ok: false, error: "You can't accept your own document." };
  }

  const link = await linkOperatorToProject(admin, user, project as ProjectRef, signerName);
  if ("error" in link) return { ok: false, error: link.error };

  return {
    ok: true,
    admin,
    user,
    project: project as ProjectRef,
    engagement: link.engagement,
    signerName,
    docId: doc.id as string,
    projectId: doc.project_id as string,
  };
}

export async function acceptAndSignQuote(token: string, input: AcceptInput): Promise<AcceptResult> {
  const prep = await prepareAccept("quotes", token, input);
  if (!prep.ok) return { error: prep.error };
  const { admin, user, signerName, docId, projectId } = prep;

  const ip = await clientIp();
  const now = new Date().toISOString();
  const { error } = await admin
    .from("quotes")
    .update({
      status: "signed",
      signed_at: now,
      signed_by_name: signerName,
      signed_by_user_id: user.id,
      signer_ip: ip,
      signature_consent: true,
      accepted_at: now,
      updated_at: now,
    })
    .eq("token", token)
    .eq("status", "sent");
  if (error) return { error: error.message };

  revalidatePath(`/quotes/${token}`);
  revalidatePath(`/b/projects/${projectId}`);
  revalidatePath(`/b/projects/${projectId}/quotes/${docId}`);
  revalidatePath("/o/project");
  return { success: true, redirectTo: "/o/project" };
}

export async function acceptAndSignContract(token: string, input: AcceptInput): Promise<AcceptResult> {
  const prep = await prepareAccept("contracts", token, input);
  if (!prep.ok) return { error: prep.error };
  const { admin, user, signerName, docId, projectId } = prep;

  const ip = await clientIp();
  const now = new Date().toISOString();
  const { error } = await admin
    .from("contracts")
    .update({
      status: "signed",
      signed_at: now,
      signed_by_name: signerName,
      signed_by_user_id: user.id,
      signer_ip: ip,
      signature_consent: true,
      updated_at: now,
    })
    .eq("token", token)
    .eq("status", "sent");
  if (error) return { error: error.message };

  // A signed contract means the deal is won — only flip active projects.
  await admin
    .from("projects")
    .update({ status: "won", updated_at: now })
    .eq("id", projectId)
    .eq("status", "active");

  // A signed contract also takes the engagement live (if the builder hasn't
  // already begun it). Stamping started_at here is what makes "engagement
  // successful" follow contract signing rather than mere doc acceptance.
  await admin
    .from("engagements")
    .update({ started_at: now })
    .eq("project_id", projectId)
    .is("started_at", null);

  revalidatePath(`/contract/${token}`);
  revalidatePath(`/b/projects/${projectId}`);
  revalidatePath(`/b/projects/${projectId}/contract/${docId}`);
  revalidatePath("/o/project");
  return { success: true, redirectTo: "/o/project" };
}

export async function acceptAndSignPrd(token: string, input: AcceptInput): Promise<AcceptResult> {
  const prep = await prepareAccept("prds", token, input);
  if (!prep.ok) return { error: prep.error };
  const { admin, user, signerName, docId, projectId } = prep;

  const ip = await clientIp();
  const now = new Date().toISOString();
  const { error } = await admin
    .from("prds")
    .update({
      status: "signed",
      signed_at: now,
      signed_by_name: signerName,
      signed_by_user_id: user.id,
      signer_ip: ip,
      signature_consent: true,
      updated_at: now,
    })
    .eq("token", token)
    .eq("status", "sent");
  if (error) return { error: error.message };

  revalidatePath(`/prd/${token}`);
  revalidatePath(`/b/projects/${projectId}`);
  revalidatePath(`/b/projects/${projectId}/prd/${docId}`);
  revalidatePath("/o/project");
  return { success: true, redirectTo: "/o/project" };
}

// ── Decline / reject ───────────────────────────────────────────────────────
// The inbound mirror of accept: a recipient can decline a sent doc, flipping it
// to "rejected" with an optional note. Lighter than prepareAccept — it does NOT
// link the recipient as the project's operator (declining isn't joining).

export type RejectResult = { success: true } | { error: string };

async function prepareReject(
  table: "quotes" | "contracts" | "prds",
  token: string
): Promise<
  | { ok: true; admin: SupabaseClient; projectId: string; docId: string }
  | { ok: false; error: string }
> {
  if (!TOKEN_RE.test(token)) return { ok: false, error: "Invalid link." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Please create an account to respond." };

  const admin = createAdminClient();
  const { data: doc } = await admin
    .from(table)
    .select("id, status, project_id")
    .eq("token", token)
    .maybeSingle();
  if (!doc) return { ok: false, error: "This document was not found." };
  if (doc.status !== "sent") return { ok: false, error: "This document is not awaiting a response." };

  const { data: project } = await admin
    .from("projects")
    .select("id, owner_id")
    .eq("id", doc.project_id as string)
    .maybeSingle();
  if (!project) return { ok: false, error: "Document not found." };
  if (project.owner_id === user.id) {
    return { ok: false, error: "You can't decline your own document." };
  }

  return { ok: true, admin, projectId: doc.project_id as string, docId: doc.id as string };
}

async function rejectDoc(
  table: "quotes" | "contracts" | "prds",
  token: string,
  note: string,
  publicPathPrefix: string,
  builderDocSegment: string
): Promise<RejectResult> {
  const prep = await prepareReject(table, token);
  if (!prep.ok) return { error: prep.error };
  const { admin, projectId, docId } = prep;

  const now = new Date().toISOString();
  const { error } = await admin
    .from(table)
    .update({
      status: "rejected",
      rejected_at: now,
      rejection_note: note.trim().slice(0, 2000) || null,
      updated_at: now,
    })
    .eq("token", token)
    .eq("status", "sent");
  if (error) return { error: error.message };

  revalidatePath(`${publicPathPrefix}/${token}`);
  revalidatePath(`/b/projects/${projectId}`);
  revalidatePath(`/b/projects/${projectId}/${builderDocSegment}/${docId}`);
  revalidatePath("/o/project");
  return { success: true };
}

export async function rejectQuote(token: string, note: string): Promise<RejectResult> {
  return rejectDoc("quotes", token, note, "/quotes", "quotes");
}

export async function rejectContract(token: string, note: string): Promise<RejectResult> {
  return rejectDoc("contracts", token, note, "/contract", "contract");
}

export async function rejectPrd(token: string, note: string): Promise<RejectResult> {
  return rejectDoc("prds", token, note, "/prd", "prd");
}
