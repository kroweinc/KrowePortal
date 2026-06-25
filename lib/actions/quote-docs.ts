"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { getProjectById } from "@/lib/actions/projects";
import { getProjectMaterials } from "@/lib/actions/project-materials";
import { getProjectSopTranscripts } from "@/lib/actions/project-sop";
import { composeBusinessContext } from "@/lib/project/business-context";
import { connectProjectToClientOnSend } from "@/lib/actions/connect-project";
import { friendlyAiError } from "@/lib/ai/client";
import { generateQuote } from "@/lib/ai/generate-quote";
import { assertAiBudget } from "@/lib/ai/usage";
import { refineQuoteSection as runRefineSection } from "@/lib/ai/refine-quote-section";
import { fieldsForSection, refinableSection } from "@/lib/quote/section-fields";
import { recomputeTotals, applyMilestonePercents } from "@/lib/quote/totals";
import type { Question } from "@/lib/ai/schemas";
import type { Quote, QuoteContent } from "@/lib/types";
import {
  resolveQuoteDraft,
  persistQuoteDraft,
  type DraftQuoteInput,
  type DraftQuoteResult,
} from "@/lib/quote/draft-core";

/** Hard cap on refine question rounds before a section patch is forced. */
const MAX_REFINE_ROUNDS = 2;

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : await createClient();
}

function revalidateQuote(projectId: string, id: string, token?: string | null) {
  revalidatePath(`/b/projects/${projectId}`);
  revalidatePath(`/b/projects/${projectId}/quotes/${id}`);
  if (token) revalidatePath(`/quotes/${token}`);
}

/**
 * Adaptive quote wizard step. Reads the chosen source (an existing PRD, raw
 * notes, or a from-scratch interview) plus accumulated answers and either asks
 * another round of clarifying questions or generates + inserts the finished
 * quote draft. The streaming route (app/api/ai/quote/stream) reuses
 * resolveQuoteDraft + persistQuoteDraft from the shared core so a streamed
 * generation is saved identically and exactly once.
 */
export async function draftQuote(input: DraftQuoteInput): Promise<DraftQuoteResult> {
  const resolved = await resolveQuoteDraft(input);
  if (!resolved.ok) {
    if (resolved.status === 401) redirect("/login");
    return { error: resolved.error };
  }

  let result;
  try {
    result = await generateQuote(resolved.genInput, { userId: resolved.profile.id, operation: "generate_quote" });
  } catch (err) {
    return { error: friendlyAiError(err) };
  }

  if (result.kind === "questions") {
    return { kind: "questions", items: result.items };
  }

  const saved = await persistQuoteDraft(resolved.save, result.content, result.contextSummary);
  if ("error" in saved) return { error: saved.error };
  return { kind: "quote", quoteId: saved.quoteId };
}

export async function regenerateQuote(
  id: string,
  notes: string
): Promise<{ success: true; content: QuoteContent } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can edit a quote." };

  const clean = (notes ?? "").trim();
  if (clean.length < 1) return { error: "Paste some notes to draft from." };
  if (clean.length > 20000) return { error: "Notes are too long." };

  const supabase = await getClient(profile.id);
  const { data: before } = await supabase
    .from("quotes")
    .select("status, created_by, title, project_id, token")
    .eq("id", id)
    .single();

  if (!before) return { error: "Quote not found." };
  if (before.created_by !== profile.id) return { error: "Not your quote." };
  if (before.status !== "draft") return { error: "Only drafts can be regenerated." };

  const project = await getProjectById(before.project_id as string);
  const materials = await getProjectMaterials(before.project_id as string);
  const sopTranscripts = await getProjectSopTranscripts(before.project_id as string);
  const result = await generateQuote({
    title: before.title as string,
    notes: clean,
    businessContext: project ? composeBusinessContext(project, materials, sopTranscripts) : undefined,
    forceFinal: true,
    currentDate: new Date().toISOString().slice(0, 10),
  });
  const content =
    result.kind === "quote"
      ? applyMilestonePercents(recomputeTotals(result.content))
      : recomputeTotals({});

  const { error } = await supabase
    .from("quotes")
    .update({ content, source_notes: clean, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidateQuote(before.project_id as string, id, before.token as string | null);
  return { success: true, content };
}

const refineSchema = z.object({
  quoteId: z.string().uuid(),
  sectionId: z.string().min(1).max(60),
  // The live quote content (incl. unsaved inline edits) sent from the client so
  // the AI refines against what the builder currently sees, not the last-saved row.
  currentContent: z.record(z.string(), z.unknown()),
  answers: z
    .array(
      z.object({
        questionId: z.string(),
        question: z.string().max(400),
        answer: z.string().max(2000),
      })
    )
    .max(20)
    .optional(),
  round: z.number().int().min(0).max(10),
});

export type RefineQuoteSectionInput = z.input<typeof refineSchema>;

export type RefineQuoteSectionResult =
  | { kind: "questions"; items: Question[] }
  | { kind: "section"; patch: Partial<QuoteContent> }
  | { error: string };

/**
 * Adaptive single-section refine. Sends the live quote content + section focus
 * to the AI and either asks a round of targeted clarifying questions or returns
 * a patch covering ONLY that section's keys. Does NOT persist — the client merges
 * the patch into its edit state (and recomputes totals) then saves through
 * updateQuoteContent.
 */
export async function refineQuoteSection(
  input: RefineQuoteSectionInput
): Promise<RefineQuoteSectionResult> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can edit a quote." };

  const budget = await assertAiBudget(profile.id);
  if (!budget.ok) return { error: budget.error };

  const parsed = refineSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const { quoteId, sectionId, currentContent, answers = [], round } = parsed.data;

  const fields = fieldsForSection(sectionId);
  if (fields.length === 0) return { error: "That section can't be refined." };
  const section = refinableSection(sectionId);

  const supabase = await getClient(profile.id);
  const { data: before } = await supabase
    .from("quotes")
    .select("created_by, source_notes")
    .eq("id", quoteId)
    .single();

  if (!before) return { error: "Quote not found." };
  if (before.created_by !== profile.id) return { error: "Not your quote." };

  let result;
  try {
    result = await runRefineSection({
      sectionId,
      sectionTitle: section?.title ?? sectionId,
      sectionFields: fields as string[],
      currentContent: currentContent as QuoteContent,
      businessContext: (before.source_notes as string | null) ?? undefined,
      answers: answers.map((a) => ({ question: a.question, answer: a.answer })),
      forceFinal: round >= MAX_REFINE_ROUNDS,
      currentDate: new Date().toISOString().slice(0, 10),
    }, { userId: profile.id, operation: "refine_quote_section" });
  } catch (err) {
    return { error: friendlyAiError(err) };
  }

  if (result.kind === "questions") return { kind: "questions", items: result.items };
  return { kind: "section", patch: result.patch };
}

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.record(z.string(), z.unknown()).optional(),
});

export async function updateQuoteContent(
  id: string,
  updates: { title?: string; content?: QuoteContent }
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can edit a quote." };

  const parsed = updateSchema.safeParse({
    title: updates.title,
    content: updates.content as Record<string, unknown> | undefined,
  });
  if (!parsed.success) return { error: "Invalid input." };

  const supabase = await getClient(profile.id);
  const { data: before } = await supabase
    .from("quotes")
    .select("status, created_by, project_id, token")
    .eq("id", id)
    .single();

  if (!before) return { error: "Quote not found." };
  if (before.created_by !== profile.id) return { error: "Not your quote." };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  // Recompute totals server-side so the persisted row is always consistent.
  if (parsed.data.content !== undefined) {
    patch.content = recomputeTotals(parsed.data.content as QuoteContent);
  }

  const { error } = await supabase.from("quotes").update(patch).eq("id", id);
  if (error) return { error: error.message };

  revalidateQuote(before.project_id as string, id, before.token as string | null);
  return { success: true };
}

export async function sendQuote(id: string): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can send a quote." };

  const supabase = await getClient(profile.id);
  const { data: before } = await supabase
    .from("quotes")
    .select("status, created_by, project_id, token")
    .eq("id", id)
    .single();

  if (!before) return { error: "Quote not found." };
  if (before.created_by !== profile.id) return { error: "Not your quote." };
  if (before.status !== "draft") return { error: "Only drafts can be sent." };

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("quotes")
    .update({ status: "sent", sent_at: now, updated_at: now })
    .eq("id", id);
  if (error) return { error: error.message };

  // Surface the quote in the client's portal right away when it's unambiguous
  // who that client is (see connectProjectToClientOnSend).
  await connectProjectToClientOnSend(before.project_id as string, profile.id);

  revalidateQuote(before.project_id as string, id, before.token as string | null);
  return { success: true };
}

export async function deleteQuote(id: string): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can delete a quote." };

  const supabase = await getClient(profile.id);
  const { data: before } = await supabase
    .from("quotes")
    .select("status, created_by, project_id")
    .eq("id", id)
    .single();

  if (!before) return { error: "Quote not found." };
  if (before.created_by !== profile.id) return { error: "Not your quote." };
  if (before.status !== "draft") return { error: "Only drafts can be deleted." };

  const { error } = await supabase.from("quotes").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(`/b/projects/${before.project_id as string}`);
  return { success: true };
}

// Revokes the public share link — the public lookup rejects a revoked row
// (migration 0062), killing access via any already-shared link.
export async function revokeQuoteShareLink(
  id: string
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can revoke a link." };

  const supabase = await getClient(profile.id);
  const { data: before } = await supabase
    .from("quotes")
    .select("created_by, project_id, token")
    .eq("id", id)
    .maybeSingle();

  if (!before) return { error: "Quote not found." };
  if (before.created_by !== profile.id) return { error: "Not your quote." };

  const { error } = await supabase
    .from("quotes")
    .update({ token_revoked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidateQuote(before.project_id as string, id, before.token as string | null);
  return { success: true };
}

// Mint a fresh share link: a new token (so old links stay dead), a reset expiry
// window, and a cleared revocation flag — the re-share path after revoke/expiry.
export async function reissueQuoteShareLink(
  id: string
): Promise<{ success: true; token: string } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can reissue a link." };

  const supabase = await getClient(profile.id);
  const { data: before } = await supabase
    .from("quotes")
    .select("created_by, project_id, token")
    .eq("id", id)
    .maybeSingle();

  if (!before) return { error: "Quote not found." };
  if (before.created_by !== profile.id) return { error: "Not your quote." };

  // supabase-js can't invoke the SQL column default on update, so mint the same
  // 64-hex shape here; expiry window matches migration 0062 (90 days for docs).
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from("quotes")
    .update({ token, token_expires_at: expires, token_revoked_at: null })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidateQuote(before.project_id as string, id, before.token as string | null);
  revalidatePath(`/quotes/${token}`);
  return { success: true, token };
}

export async function getQuotesByProject(projectId: string): Promise<Quote[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];

  const supabase = await getClient(profile.id);
  // Owner-scoped (created_by == project owner). RLS enforces this for the normal
  // client; the dev admin client bypasses RLS, so we replicate the scope here.
  // Keeps `*` (incl. content) on purpose: quote list rows render the grand total
  // via quoteDocMeta (content.totals.grand), and contract auto-fill reads content.
  const { data } = await supabase
    .from("quotes")
    .select("*")
    .eq("project_id", projectId)
    .eq("created_by", profile.id)
    .order("created_at", { ascending: false });

  return (data ?? []) as Quote[];
}

export async function getQuoteById(id: string): Promise<Quote | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const supabase = await getClient(profile.id);
  // Owner-scoped: the dev admin client bypasses RLS, so guard by created_by here.
  const { data } = await supabase
    .from("quotes")
    .select("*")
    .eq("id", id)
    .eq("created_by", profile.id)
    .maybeSingle();
  return (data ?? null) as Quote | null;
}
