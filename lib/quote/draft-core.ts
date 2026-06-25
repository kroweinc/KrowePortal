/**
 * Quote draft core — the auth/setup/save logic shared by the blocking `draftQuote`
 * server action (lib/actions/quote-docs.ts) and the streaming route handler
 * (app/api/ai/quote/stream/route.ts). Kept OUT of the "use server" action file so
 * these can be plain server-only helpers (not client-callable RPC) and so the zod
 * schema can be exported as a value. Server-only — never import from a client
 * component.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { getProjectById } from "@/lib/actions/projects";
import { getProjectMaterials } from "@/lib/actions/project-materials";
import { getProjectSopTranscripts } from "@/lib/actions/project-sop";
import { composeBusinessContext } from "@/lib/project/business-context";
import { getPrdById } from "@/lib/actions/prds";
import { assertAiBudget } from "@/lib/ai/usage";
import { recomputeTotals, applyMilestonePercents } from "@/lib/quote/totals";
import { applyPricingDefaults } from "@/lib/quote/defaults";
import { getPricingDefaults } from "@/lib/actions/pricing-defaults";
import type { QuoteGenInput } from "@/lib/ai/generate-quote";
import type { Question } from "@/lib/ai/schemas";
import type { QuoteContent, PrdContent } from "@/lib/types";

/** Hard cap on adaptive question rounds before a quote is forced. */
const MAX_QUOTE_ROUNDS = 4;
/** Raised cap for the from-scratch "deep context" path: broad→specific over more rounds. */
const MAX_QUOTE_ROUNDS_DEEP = 7;

export async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : await createClient();
}

export const draftQuoteSchema = z.object({
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

export type DraftQuoteInput = z.input<typeof draftQuoteSchema>;

export type DraftQuoteResult =
  | { kind: "questions"; items: Question[] }
  | { kind: "quote"; quoteId: string }
  | { error: string };

type Profile = NonNullable<Awaited<ReturnType<typeof getCurrentProfile>>>;
type Project = NonNullable<Awaited<ReturnType<typeof getProjectById>>>;
type PricingDefaults = Awaited<ReturnType<typeof getPricingDefaults>>;
type QuoteAnswerRow = { questionId: string; question: string; answer: string };

/** Everything persistQuoteDraft needs to save a finished quote — captured once
    during resolution so the action and the streaming route save identically. */
export type QuoteSaveContext = {
  profile: Profile;
  project: Project;
  projectId: string;
  title: string;
  source: "prd" | "scratch" | "notes";
  sourcePrdId?: string;
  notes?: string;
  answers: QuoteAnswerRow[];
  deepContext: boolean;
  pricingDefaults: PricingDefaults;
};

export type QuoteDraftResolution =
  | { ok: false; status: number; error: string }
  | { ok: true; profile: Profile; genInput: QuoteGenInput; save: QuoteSaveContext };

/**
 * Shared setup for a quote generation round: auth, validation, ownership, the
 * source PRD load (from-PRD path), project reads, budget gate, pricing defaults,
 * and the deep-context / forceFinal decision. Returns the generator input plus the
 * save context.
 */
export async function resolveQuoteDraft(input: DraftQuoteInput): Promise<QuoteDraftResolution> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, status: 401, error: "Not signed in." };
  if (profile.role !== "builder") return { ok: false, status: 403, error: "Only builders can create quotes." };

  const parsed = draftQuoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const { projectId, title, source, sourcePrdId, notes, answers = [], round } = parsed.data;

  const project = await getProjectById(projectId);
  if (!project) return { ok: false, status: 404, error: "Document not found." };
  if (project.owner_id !== profile.id) return { ok: false, status: 403, error: "Not your document." };

  const materials = await getProjectMaterials(projectId);
  const sopTranscripts = await getProjectSopTranscripts(projectId);

  // Load the source PRD (from-PRD path). It must belong to the same project.
  let prdContent: PrdContent | undefined;
  if (source === "prd") {
    if (!sourcePrdId) return { ok: false, status: 400, error: "Pick a PRD to generate the quote from." };
    const prd = await getPrdById(sourcePrdId);
    if (!prd || prd.project_id !== projectId) return { ok: false, status: 404, error: "PRD not found." };
    prdContent = prd.content;
  }

  // Deep context-gathering mode whenever there's no source material to price from:
  // the "from scratch" path, or a "from notes" path where notes were left blank.
  const hasNotes = source === "notes" && (notes?.trim().length ?? 0) > 0;
  const deepContext = source === "scratch" || (source === "notes" && !hasNotes);
  const forceFinal = round >= (deepContext ? MAX_QUOTE_ROUNDS_DEEP : MAX_QUOTE_ROUNDS);

  const budget = await assertAiBudget(profile.id);
  if (!budget.ok) return { ok: false, status: 429, error: budget.error };

  // Builder's pricing defaults seed every new quote (rate, payment terms, design).
  const pricingDefaults = await getPricingDefaults(profile.id);

  const genInput: QuoteGenInput = {
    title,
    notes: source === "notes" ? notes : undefined,
    prdContent,
    businessContext: composeBusinessContext(project, materials, sopTranscripts),
    answers: answers.map((a) => ({ question: a.question, answer: a.answer })),
    forceFinal,
    deepContext,
    hourlyRate: pricingDefaults.hourlyRate,
    currentDate: new Date().toISOString().slice(0, 10),
  };

  return {
    ok: true,
    profile,
    genInput,
    save: { profile, project, projectId, title, source, sourcePrdId, notes, answers, deepContext, pricingDefaults },
  };
}

/**
 * Persist a finished quote draft: tie out all arithmetic (seed pricing defaults,
 * then price line items by hours × rate and derive milestone amounts), insert the
 * row, and write back the synthesized business context (deep path). Returns the new
 * id. Shared by the action and the streaming route so a generation is saved once.
 */
export async function persistQuoteDraft(
  save: QuoteSaveContext,
  rawContent: QuoteContent,
  contextSummary?: string
): Promise<{ quoteId: string } | { error: string }> {
  const { profile, project, projectId, title, source, sourcePrdId, notes, answers, deepContext, pricingDefaults } = save;

  const transcript = answers.length
    ? answers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join("\n\n")
    : "";
  const sourceNotes = [notes?.trim(), transcript].filter(Boolean).join("\n\n---\n\n") || null;

  // Defaults must be applied BEFORE recompute so the design fee feeds the grand
  // total and milestones derive from it.
  const content = applyMilestonePercents(
    recomputeTotals(applyPricingDefaults(rawContent, pricingDefaults))
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
  if (deepContext && contextSummary && !project.context?.trim()) {
    try {
      await supabase
        .from("projects")
        .update({ context: contextSummary, updated_at: new Date().toISOString() })
        .eq("id", projectId);
    } catch {
      // ignore — context write-back is non-critical
    }
  }

  revalidatePath(`/b/projects/${projectId}`);
  return { quoteId: data.id as string };
}
