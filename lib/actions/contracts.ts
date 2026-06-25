"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { getProjectById } from "@/lib/actions/projects";
import { getQuotesByProject, getQuoteById } from "@/lib/actions/quote-docs";
import { getPrdsByProject, getPrdById } from "@/lib/actions/prds";
import { generateContractDraft } from "@/lib/ai/generate-contract";
import { assertAiBudget } from "@/lib/ai/usage";
import { exhibitFromQuote } from "@/lib/contract/exhibit";
import { getProjectSopTranscripts } from "@/lib/actions/project-sop";
import { composeSopBlock } from "@/lib/project/business-context";
import { todayISODate, isISODate } from "@/lib/contract/effective-date";
import { connectProjectToClientOnSend } from "@/lib/actions/connect-project";
import type { Contract, ContractContent, ContractSummary, QuoteContent, PrdContent } from "@/lib/types";

// Columns for list/summary reads — every Contract field except the heavy
// `content` jsonb, which no contract list view renders.
const CONTRACT_SUMMARY_COLUMNS =
  "id, project_id, created_by, title, status, source_notes, token, sent_at, signed_by_name, signed_at, signer_ip, signature_consent, signed_by_user_id, rejected_at, rejection_note, created_at, updated_at";

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : await createClient();
}

function revalidateContract(projectId: string, id: string, token?: string | null) {
  revalidatePath(`/b/projects/${projectId}`);
  revalidatePath(`/b/projects/${projectId}/contract/${id}`);
  if (token) revalidatePath(`/contract/${token}`);
}

// The contract should stay consistent with the project's quote breakdown.
// Prefer an accepted/signed quote, then the most recent sent one, then the
// latest draft (getQuotesByProject returns newest-first).
async function bestQuoteContent(projectId: string): Promise<QuoteContent | undefined> {
  const quotes = await getQuotesByProject(projectId);
  if (quotes.length === 0) return undefined;
  const signed = quotes.find((q) => q.status === "signed" || q.status === "accepted");
  const sent = quotes.find((q) => q.status === "sent");
  return (signed ?? sent ?? quotes[0]).content;
}

// The contract's scope of services and deliverables should reflect the
// project's PRD. Same selection logic as the quote: signed, then sent, then
// the latest draft. Returns undefined if the project has no PRD yet.
async function bestPrdContent(projectId: string): Promise<PrdContent | undefined> {
  const prds = await getPrdsByProject(projectId);
  if (prds.length === 0) return undefined;
  const signed = prds.find((p) => p.status === "signed");
  const sent = prds.find((p) => p.status === "sent");
  return (signed ?? sent ?? prds[0]).content;
}

// Explicit picks from the new-contract form: load the chosen quote / PRD by id,
// scoped to the project (defends against attaching another project's doc). An
// absent id means the builder chose to draft without that source.
async function selectedQuoteContent(
  projectId: string,
  quoteId?: string
): Promise<QuoteContent | undefined> {
  if (!quoteId) return undefined;
  const quote = await getQuoteById(quoteId);
  if (!quote || quote.project_id !== projectId) return undefined;
  return quote.content;
}

async function selectedPrdContent(
  projectId: string,
  prdId?: string
): Promise<PrdContent | undefined> {
  if (!prdId) return undefined;
  const prd = await getPrdById(prdId);
  if (!prd || prd.project_id !== projectId) return undefined;
  return prd.content;
}

const createSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1, "Give the contract a title.").max(200),
  // Notes are optional — the builder can draft purely from a selected quote/PRD.
  notes: z.string().max(20000).optional(),
  providerName: z.string().max(200).optional(),
  // Which quote/PRD to build from (chosen in the form). Empty = none.
  prdId: z.string().uuid().optional(),
  quoteId: z.string().uuid().optional(),
});

export async function createContractDraft(
  formData: FormData
): Promise<{ error: string } | { contractId: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders can create contracts." };

  const parsed = createSchema.safeParse({
    projectId: formData.get("projectId"),
    title: formData.get("title"),
    notes: formData.get("notes") || undefined,
    providerName: formData.get("providerName") || undefined,
    prdId: formData.get("prdId") || undefined,
    quoteId: formData.get("quoteId") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const project = await getProjectById(parsed.data.projectId);
  if (!project) return { error: "Document not found." };
  if (project.owner_id !== profile.id) return { error: "Not your document." };

  const quoteContent = await selectedQuoteContent(parsed.data.projectId, parsed.data.quoteId);
  const prdContent = await selectedPrdContent(parsed.data.projectId, parsed.data.prdId);
  const sopContext = composeSopBlock(await getProjectSopTranscripts(parsed.data.projectId));

  const budget = await assertAiBudget(profile.id);
  if (!budget.ok) return { error: budget.error };

  const aiContent = await generateContractDraft(
    {
      title: parsed.data.title,
      notes: parsed.data.notes ?? "",
      providerName: parsed.data.providerName ?? profile.display_name ?? undefined,
      clientName: project.prospect_name ?? project.name,
      quoteContent,
      prdContent,
      sopContext,
    },
    { userId: profile.id, operation: "generate_contract" }
  );
  // Freeze the quote's payment schedule + scope of work into the contract.
  const content: ContractContent = { ...aiContent, ...exhibitFromQuote(quoteContent) };

  const supabase = await getClient(profile.id);
  const { data, error } = await supabase
    .from("contracts")
    .insert({
      project_id: parsed.data.projectId,
      created_by: profile.id,
      title: parsed.data.title,
      status: "draft",
      content,
      source_notes: parsed.data.notes ?? null,
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Failed to create contract." };

  revalidatePath(`/b/projects/${parsed.data.projectId}`);
  // Return the id and let the client navigate, so a builder who cancels the
  // generation (Esc / Cancel) isn't yanked into the draft by a server redirect.
  return { contractId: data.id as string };
}

export async function regenerateContract(
  id: string,
  notes: string
): Promise<{ success: true; content: ContractContent } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can edit a contract." };

  const clean = (notes ?? "").trim();
  if (clean.length < 1) return { error: "Paste some notes to draft from." };
  if (clean.length > 20000) return { error: "Notes are too long." };

  const supabase = await getClient(profile.id);
  const { data: before } = await supabase
    .from("contracts")
    .select("status, created_by, title, project_id, token")
    .eq("id", id)
    .single();

  if (!before) return { error: "Contract not found." };
  if (before.created_by !== profile.id) return { error: "Not your contract." };
  if (before.status !== "draft") return { error: "Only drafts can be regenerated." };

  const project = await getProjectById(before.project_id as string);
  const quoteContent = await bestQuoteContent(before.project_id as string);
  const prdContent = await bestPrdContent(before.project_id as string);
  const sopContext = composeSopBlock(await getProjectSopTranscripts(before.project_id as string));
  const aiContent = await generateContractDraft({
    title: before.title as string,
    notes: clean,
    providerName: profile.display_name ?? undefined,
    clientName: project?.prospect_name ?? project?.name,
    quoteContent,
    prdContent,
    sopContext,
  });
  // Re-snapshot the exhibit so a re-draft picks up the latest quote breakdown.
  const content: ContractContent = { ...aiContent, ...exhibitFromQuote(quoteContent) };

  const { error } = await supabase
    .from("contracts")
    .update({ content, source_notes: clean, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidateContract(before.project_id as string, id, before.token as string | null);
  return { success: true, content };
}

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.record(z.string(), z.unknown()).optional(),
});

export async function updateContractContent(
  id: string,
  updates: { title?: string; content?: ContractContent }
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can edit a contract." };

  const parsed = updateSchema.safeParse({
    title: updates.title,
    content: updates.content as Record<string, unknown> | undefined,
  });
  if (!parsed.success) return { error: "Invalid input." };

  const supabase = await getClient(profile.id);
  const { data: before } = await supabase
    .from("contracts")
    .select("status, created_by, project_id, token")
    .eq("id", id)
    .single();

  if (!before) return { error: "Contract not found." };
  if (before.created_by !== profile.id) return { error: "Not your contract." };
  if (before.status === "signed") return { error: "Signed contracts can't be edited." };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.content !== undefined) patch.content = parsed.data.content;

  const { error } = await supabase.from("contracts").update(patch).eq("id", id);
  if (error) return { error: error.message };

  revalidateContract(before.project_id as string, id, before.token as string | null);
  return { success: true };
}

// `clientEffectiveDate` is the builder's local `YYYY-MM-DD` (the date they saw
// in the draft). Sending freezes the effective date to that day; until then it
// floats to the current date. We validate it and fall back to the server's date.
export async function sendContract(
  id: string,
  clientEffectiveDate?: string
): Promise<{ success: true; effectiveDate: string } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can send a contract." };

  const supabase = await getClient(profile.id);
  const { data: before } = await supabase
    .from("contracts")
    .select("status, created_by, project_id, token, content")
    .eq("id", id)
    .single();

  if (!before) return { error: "Contract not found." };
  if (before.created_by !== profile.id) return { error: "Not your contract." };
  if (before.status !== "draft") return { error: "Only drafts can be sent." };

  const effectiveDate = isISODate(clientEffectiveDate) ? clientEffectiveDate : todayISODate();
  const content: ContractContent = { ...((before.content as ContractContent) ?? {}), effectiveDate };

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("contracts")
    .update({ status: "sent", sent_at: now, updated_at: now, content })
    .eq("id", id);
  if (error) return { error: error.message };

  // Surface the contract in the client's portal right away when it's
  // unambiguous who that client is (see connectProjectToClientOnSend).
  await connectProjectToClientOnSend(before.project_id as string, profile.id);

  revalidateContract(before.project_id as string, id, before.token as string | null);
  return { success: true, effectiveDate };
}

export async function deleteContract(id: string): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can delete a contract." };

  const supabase = await getClient(profile.id);
  const { data: before } = await supabase
    .from("contracts")
    .select("status, created_by, project_id")
    .eq("id", id)
    .single();

  if (!before) return { error: "Contract not found." };
  if (before.created_by !== profile.id) return { error: "Not your contract." };
  if (before.status !== "draft") return { error: "Only drafts can be deleted." };

  const { error } = await supabase.from("contracts").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(`/b/projects/${before.project_id as string}`);
  return { success: true };
}

// Revokes the public share link. The token stays in place but the public lookup
// rejects a revoked row (migration 0062), immediately killing access via any
// already-shared/leaked link. Reissue (below) mints a fresh link afterward.
export async function revokeContractShareLink(
  id: string
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can revoke a link." };

  const supabase = await getClient(profile.id);
  const { data: before } = await supabase
    .from("contracts")
    .select("created_by, project_id, token")
    .eq("id", id)
    .maybeSingle();

  if (!before) return { error: "Contract not found." };
  if (before.created_by !== profile.id) return { error: "Not your contract." };

  const { error } = await supabase
    .from("contracts")
    .update({ token_revoked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidateContract(before.project_id as string, id, before.token as string | null);
  return { success: true };
}

// Mint a fresh share link: a new token (so old links stay dead), a reset expiry
// window, and a cleared revocation flag — the re-share path after revoke/expiry.
export async function reissueContractShareLink(
  id: string
): Promise<{ success: true; token: string } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can reissue a link." };

  const supabase = await getClient(profile.id);
  const { data: before } = await supabase
    .from("contracts")
    .select("created_by, project_id, token")
    .eq("id", id)
    .maybeSingle();

  if (!before) return { error: "Contract not found." };
  if (before.created_by !== profile.id) return { error: "Not your contract." };

  // supabase-js can't invoke the SQL column default on update, so mint the same
  // 64-hex shape here; expiry window matches migration 0062 (90 days for docs).
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from("contracts")
    .update({ token, token_expires_at: expires, token_revoked_at: null })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidateContract(before.project_id as string, id, before.token as string | null);
  revalidatePath(`/contract/${token}`);
  return { success: true, token };
}

export async function getContractsByProject(projectId: string): Promise<ContractSummary[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];

  const supabase = await getClient(profile.id);
  // Owner-scoped (created_by == project owner). RLS enforces this for the normal
  // client; the dev admin client bypasses RLS, so we replicate the scope here.
  // List read: omit the heavy `content` jsonb (unused by every contract list view).
  const { data } = await supabase
    .from("contracts")
    .select(CONTRACT_SUMMARY_COLUMNS)
    .eq("project_id", projectId)
    .eq("created_by", profile.id)
    .order("created_at", { ascending: false });

  return (data ?? []) as ContractSummary[];
}

export async function getContractById(id: string): Promise<Contract | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const supabase = await getClient(profile.id);
  // Owner-scoped: the dev admin client bypasses RLS, so guard by created_by here.
  const { data } = await supabase
    .from("contracts")
    .select("*")
    .eq("id", id)
    .eq("created_by", profile.id)
    .maybeSingle();
  return (data ?? null) as Contract | null;
}
