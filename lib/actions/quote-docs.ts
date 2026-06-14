"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { getProjectById } from "@/lib/actions/projects";
import { getProjectMaterials } from "@/lib/actions/project-materials";
import { getProjectSopTranscripts } from "@/lib/actions/project-sop";
import { composeBusinessContext } from "@/lib/project/business-context";
import { getPrdById } from "@/lib/actions/prds";
import { connectProjectToClientOnSend } from "@/lib/actions/connect-project";
import { friendlyAiError } from "@/lib/ai/client";
import { generateQuote } from "@/lib/ai/generate-quote";
import { assertAiBudget } from "@/lib/ai/usage";
import { refineQuoteSection as runRefineSection } from "@/lib/ai/refine-quote-section";
import { fieldsForSection, refinableSection } from "@/lib/quote/section-fields";
import { recomputeTotals, applyMilestonePercents } from "@/lib/quote/totals";
import { applyPricingDefaults } from "@/lib/quote/defaults";
import { getPricingDefaults } from "@/lib/actions/pricing-defaults";
import type { Question } from "@/lib/ai/schemas";
import type { Quote, QuoteContent, PrdContent } from "@/lib/types";

/** Hard cap on adaptive question rounds before a quote is forced. */
const MAX_QUOTE_ROUNDS = 4;

/** Raised cap for the from-scratch "deep context" path: broad→specific over more rounds. */
const MAX_QUOTE_ROUNDS_DEEP = 7;

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

const draftSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1, "Give the quote a title.").max(200),
  source: z.enum(["prd", "scratch", "notes"]),
  sourcePrdId: z.string().uuid().optional(),
  notes: z.string().max(20000).optional(),
  answers: z
    .array(
      z.object({
        questionId: z.string(),
        question: z.string().max(400),
        answer: z.string().max(2000),
      })
    )
    .max(40)
    .optional(),
  round: z.number().int().min(0).max(10),
});

export type DraftQuoteInput = z.input<typeof draftSchema>;

export type DraftQuoteResult =
  | { kind: "questions"; items: Question[] }
  | { kind: "quote"; quoteId: string }
  | { error: string };

/**
 * Adaptive quote wizard step. Reads the chosen source (an existing PRD, raw
 * notes, or a from-scratch interview) plus accumulated answers and either asks
 * another round of clarifying questions or generates + inserts the finished
 * quote draft (returning its id for the client to redirect to).
 */
export async function draftQuote(input: DraftQuoteInput): Promise<DraftQuoteResult> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders can create quotes." };

  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const { projectId, title, source, sourcePrdId, notes, answers = [], round } = parsed.data;

  const project = await getProjectById(projectId);
  if (!project) return { error: "Document not found." };
  if (project.owner_id !== profile.id) return { error: "Not your document." };

  const materials = await getProjectMaterials(projectId);
  const sopTranscripts = await getProjectSopTranscripts(projectId);

  // Load the source PRD (from-PRD path). It must belong to the same project.
  let prdContent: PrdContent | undefined;
  if (source === "prd") {
    if (!sourcePrdId) return { error: "Pick a PRD to generate the quote from." };
    const prd = await getPrdById(sourcePrdId);
    if (!prd || prd.project_id !== projectId) return { error: "PRD not found." };
    prdContent = prd.content;
  }

  // Deep context-gathering mode whenever there's no source material to price
  // from: the "from scratch" path, or a "from notes" path where notes were left
  // blank (notes are optional). Deep mode runs more rounds, asks broad→specific
  // questions, and synthesizes a context summary saved back to the project.
  const hasNotes = source === "notes" && (notes?.trim().length ?? 0) > 0;
  const deepContext = source === "scratch" || (source === "notes" && !hasNotes);
  const forceFinal = round >= (deepContext ? MAX_QUOTE_ROUNDS_DEEP : MAX_QUOTE_ROUNDS);

  const budget = await assertAiBudget(profile.id);
  if (!budget.ok) return { error: budget.error };

  // Builder's pricing defaults seed every new quote (rate, payment terms, design).
  const pricingDefaults = await getPricingDefaults(profile.id);

  let result;
  try {
    result = await generateQuote(
      {
        title,
        notes: source === "notes" ? notes : undefined,
        prdContent,
        businessContext: composeBusinessContext(project, materials, sopTranscripts),
        answers: answers.map((a) => ({ question: a.question, answer: a.answer })),
        forceFinal,
        deepContext,
        hourlyRate: pricingDefaults.hourlyRate,
        currentDate: new Date().toISOString().slice(0, 10),
      },
      { userId: profile.id, operation: "generate_quote" }
    );
  } catch (err) {
    return { error: friendlyAiError(err) };
  }

  if (result.kind === "questions") {
    return { kind: "questions", items: result.items };
  }

  // Final quote — persist a draft and hand back its id.
  const transcript = answers.length
    ? answers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join("\n\n")
    : "";
  const sourceNotes = [notes?.trim(), transcript].filter(Boolean).join("\n\n---\n\n") || null;

  // Seed the builder's defaults (rate, payment terms, design system), then tie all
  // arithmetic out regardless of model drift: price line items by hours × rate and
  // derive milestone amounts from the percents. Defaults must be applied BEFORE
  // recompute so the design fee feeds the grand total and milestones derive from it.
  const content = applyMilestonePercents(
    recomputeTotals(applyPricingDefaults(result.content, pricingDefaults))
  );

  const supabase = await getClient(profile.id);
  const { data, error } = await supabase
    .from("quotes")
    .insert({
      project_id: projectId,
      created_by: profile.id,
      title,
      status: "draft",
      content,
      source_notes: sourceNotes,
      source_prd_id: source === "prd" ? sourcePrdId : null,
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Failed to create quote." };

  // Deep-context path: persist the synthesized business context to the project so
  // future documents start warm. Only when the project has no context yet.
  if (deepContext && result.contextSummary && !project.context?.trim()) {
    try {
      await supabase
        .from("projects")
        .update({ context: result.contextSummary, updated_at: new Date().toISOString() })
        .eq("id", projectId);
    } catch {
      // ignore — context write-back is non-critical
    }
  }

  revalidatePath(`/b/projects/${projectId}`);
  return { kind: "quote", quoteId: data.id as string };
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

export async function getQuotesByProject(projectId: string): Promise<Quote[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];

  const supabase = await getClient(profile.id);
  // Owner-scoped (created_by == project owner). RLS enforces this for the normal
  // client; the dev admin client bypasses RLS, so we replicate the scope here.
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
