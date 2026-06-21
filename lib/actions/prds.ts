"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { getProjectById } from "@/lib/actions/projects";
import { getProjectMaterials } from "@/lib/actions/project-materials";
import { getProjectSopTranscripts } from "@/lib/actions/project-sop";
import { composeBusinessContext } from "@/lib/project/business-context";
import { generatePrd } from "@/lib/ai/generate-prd";
import { assertAiBudget } from "@/lib/ai/usage";
import { analyzeFreeTierFit, stackServiceNames } from "@/lib/ai/free-tier-fit";
import { refinePrdSection as runRefineSection } from "@/lib/ai/refine-prd-section";
import { connectProjectToClientOnSend } from "@/lib/actions/connect-project";
import { fieldsForSection, refinableSection } from "@/lib/prd/section-fields";
import { SCOPE_STAGE_COUNT } from "@/lib/prd/scope-stages";
import type { Question } from "@/lib/ai/schemas";
import { PrdContentSchema } from "@/lib/ai/schemas";
import type { Prd, PrdContent } from "@/lib/types";

/** Hard cap on adaptive question rounds before a PRD is forced. */
const MAX_PRD_ROUNDS = 5;

/** No-notes "deep context" path: one round per fixed scope stage, then force the PRD. */
const MAX_PRD_ROUNDS_DEEP = SCOPE_STAGE_COUNT;

/** Hard cap on refine question rounds before a section patch is forced. */
const MAX_REFINE_ROUNDS = 2;

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : await createClient();
}

function revalidatePrd(projectId: string, id: string, token?: string | null) {
  revalidatePath(`/b/projects/${projectId}`);
  revalidatePath(`/b/projects/${projectId}/prd/${id}`);
  if (token) revalidatePath(`/prd/${token}`);
}

/**
 * Best-effort Free-Tier Fit (§15) computed at generation time so a freshly drafted
 * or regenerated PRD already ships with its free-tier verdicts — the same analysis
 * the builder can re-run by hand from the editor. Returns the content untouched when
 * there's no billable stack to assess or the AI call fails: PRD creation must never
 * hinge on this side analysis.
 */
async function withFreeTierAnalysis(content: PrdContent): Promise<PrdContent> {
  const hasStack = (content.techStack?.length ?? 0) > 0;
  const hasIntegrations = (content.integrations?.length ?? 0) > 0;
  if (!hasStack && !hasIntegrations) return content;

  try {
    const analysis = await analyzeFreeTierFit(content, content.scaleAssumptions);
    if (!analysis.services.length) return content;
    analysis.analyzedAt = new Date().toISOString();
    analysis.analyzedStack = stackServiceNames(content);
    return { ...content, freeTierAnalysis: analysis };
  } catch {
    return content;
  }
}

const draftSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1, "Give the PRD a title.").max(200),
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

export type DraftPrdInput = z.input<typeof draftSchema>;

export type DraftPrdResult =
  | { kind: "questions"; items: Question[] }
  | { kind: "prd"; prdId: string }
  | { error: string };

/**
 * Adaptive PRD wizard step. Reads notes + accumulated answers and either asks
 * another round of clarifying questions or generates + inserts the finished
 * PRD draft (returning its id for the client to redirect to).
 */
export async function draftPrd(input: DraftPrdInput): Promise<DraftPrdResult> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders can create PRDs." };

  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const { projectId, title, notes, answers = [], round } = parsed.data;

  const project = await getProjectById(projectId);
  if (!project) return { error: "Document not found." };
  if (project.owner_id !== profile.id) return { error: "Not your document." };

  // These three reads are independent — run them concurrently rather than serially.
  const [materials, sopTranscripts, budget] = await Promise.all([
    getProjectMaterials(projectId),
    getProjectSopTranscripts(projectId),
    assertAiBudget(profile.id),
  ]);
  if (!budget.ok) return { error: budget.error };

  // No written notes ⇒ deep context-gathering mode: a fixed step-by-step scope
  // intake (one stage per round), then a synthesized context summary saved back
  // to the project. `stageIndex` maps the current round to its scope stage.
  const deepContext = !(notes && notes.trim().length > 0);
  const forceFinal = round >= (deepContext ? MAX_PRD_ROUNDS_DEEP : MAX_PRD_ROUNDS);
  const stageIndex = deepContext ? Math.min(round, SCOPE_STAGE_COUNT - 1) : undefined;

  let result;
  try {
    result = await generatePrd(
      {
        title,
        notes,
        businessContext: composeBusinessContext(project, materials, sopTranscripts),
        answers: answers.map((a) => ({ question: a.question, answer: a.answer })),
        forceFinal,
        deepContext,
        stageIndex,
        currentDate: new Date().toISOString().slice(0, 10),
      },
      { userId: profile.id, operation: "generate_prd" }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI generation failed";
    return { error: msg };
  }

  if (result.kind === "questions") {
    return { kind: "questions", items: result.items };
  }

  // Final PRD — persist a draft and hand back its id. Capture the narrowed PRD
  // branch into consts so the after() closure below keeps the right types.
  const prdContent = result.content;
  const contextSummary = result.contextSummary;
  const transcript = answers.length
    ? answers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join("\n\n")
    : "";
  const sourceNotes = [notes?.trim(), transcript].filter(Boolean).join("\n\n---\n\n") || null;

  const supabase = await getClient(profile.id);
  const { data, error } = await supabase
    .from("prds")
    .insert({
      project_id: projectId,
      created_by: profile.id,
      title,
      status: "draft",
      content: prdContent,
      source_notes: sourceNotes,
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Failed to create PRD." };
  const prdId = data.id as string;

  // Deep-context path: persist the synthesized business context to the project so
  // future documents (PRDs/quotes/contracts) start warm. Only when the project has
  // no context yet — never clobber what the builder already wrote. Best-effort: a
  // failed write-back must never break PRD creation.
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

  // Free-Tier Fit (§15) is a separate ~3–5s AI call. Run it AFTER the response is
  // sent so the builder reaches the editor immediately; the verdicts persist a
  // moment later and appear on the next load (the editor shows an empty state +
  // manual re-run until then). Best-effort — PRD creation never hinges on it.
  after(async () => {
    try {
      const analyzed = await withFreeTierAnalysis(prdContent);
      if (!analyzed.freeTierAnalysis) return;
      // Ownership was verified above; the admin client bypasses RLS and avoids
      // relying on request cookies that may be gone after the response.
      const admin = createAdminClient();
      const { data: row } = await admin.from("prds").select("content").eq("id", prdId).single();
      const current = (row?.content as PrdContent | null) ?? prdContent;
      // Merge ONLY freeTierAnalysis so a quick builder edit to other fields isn't clobbered.
      await admin
        .from("prds")
        .update({ content: { ...current, freeTierAnalysis: analyzed.freeTierAnalysis } })
        .eq("id", prdId);
    } catch {
      // best-effort: §15 stays empty; the builder can re-run it from the editor.
    }
  });

  revalidatePath(`/b/projects/${projectId}`);
  return { kind: "prd", prdId };
}

export async function regeneratePrd(
  id: string,
  notes: string
): Promise<{ success: true; content: PrdContent } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can edit a PRD." };

  const clean = (notes ?? "").trim();
  if (clean.length < 1) return { error: "Paste some notes to draft from." };
  if (clean.length > 20000) return { error: "Notes are too long." };

  const supabase = await getClient(profile.id);
  const { data: before } = await supabase
    .from("prds")
    .select("status, created_by, title, project_id, token")
    .eq("id", id)
    .single();

  if (!before) return { error: "PRD not found." };
  if (before.created_by !== profile.id) return { error: "Not your PRD." };
  if (before.status !== "draft") return { error: "Only drafts can be regenerated." };

  const [project, materials, sopTranscripts] = await Promise.all([
    getProjectById(before.project_id as string),
    getProjectMaterials(before.project_id as string),
    getProjectSopTranscripts(before.project_id as string),
  ]);
  const result = await generatePrd({
    title: before.title as string,
    notes: clean,
    businessContext: project ? composeBusinessContext(project, materials, sopTranscripts) : undefined,
    forceFinal: true,
    currentDate: new Date().toISOString().slice(0, 10),
  });
  const content = result.kind === "prd" ? await withFreeTierAnalysis(result.content) : {};

  const { error } = await supabase
    .from("prds")
    .update({ content, source_notes: clean, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePrd(before.project_id as string, id, before.token as string | null);
  return { success: true, content };
}

const refineSchema = z.object({
  prdId: z.string().uuid(),
  sectionId: z.string().min(1).max(60),
  // The live PRD content (incl. unsaved inline edits) sent from the client so the
  // AI refines against what the builder currently sees, not the last-saved row.
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

export type RefinePrdSectionInput = z.input<typeof refineSchema>;

export type RefinePrdSectionResult =
  | { kind: "questions"; items: Question[] }
  | { kind: "section"; patch: Partial<PrdContent> }
  | { error: string };

/**
 * Adaptive single-section refine. Sends the live PRD content + section focus to
 * the AI and either asks a round of targeted clarifying questions or returns a
 * patch covering ONLY that section's keys. Does NOT persist — the client merges
 * the patch into its edit state and saves through updatePrdContent.
 */
export async function refinePrdSection(input: RefinePrdSectionInput): Promise<RefinePrdSectionResult> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can edit a PRD." };

  const budget = await assertAiBudget(profile.id);
  if (!budget.ok) return { error: budget.error };

  const parsed = refineSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const { prdId, sectionId, currentContent, answers = [], round } = parsed.data;

  const fields = fieldsForSection(sectionId);
  if (fields.length === 0) return { error: "That section can't be refined." };
  const section = refinableSection(sectionId);

  const supabase = await getClient(profile.id);
  const { data: before } = await supabase
    .from("prds")
    .select("created_by, source_notes")
    .eq("id", prdId)
    .single();

  if (!before) return { error: "PRD not found." };
  if (before.created_by !== profile.id) return { error: "Not your PRD." };

  let result;
  try {
    result = await runRefineSection({
      sectionId,
      sectionTitle: section?.title ?? sectionId,
      sectionFields: fields as string[],
      currentContent: currentContent as PrdContent,
      businessContext: (before.source_notes as string | null) ?? undefined,
      answers: answers.map((a) => ({ question: a.question, answer: a.answer })),
      forceFinal: round >= MAX_REFINE_ROUNDS,
      currentDate: new Date().toISOString().slice(0, 10),
    }, { userId: profile.id, operation: "refine_prd_section" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI refine failed";
    return { error: msg };
  }

  if (result.kind === "questions") return { kind: "questions", items: result.items };
  return { kind: "section", patch: result.patch };
}

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  // Validate the content shape (all keys optional) so builder saves get the same
  // structural guards as AI generation — partial() never strips/injects keys.
  content: PrdContentSchema.partial().optional(),
});

export async function updatePrdContent(
  id: string,
  updates: { title?: string; content?: PrdContent }
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can edit a PRD." };

  const parsed = updateSchema.safeParse({
    title: updates.title,
    content: updates.content as Record<string, unknown> | undefined,
  });
  if (!parsed.success) return { error: "Invalid input." };

  const supabase = await getClient(profile.id);
  const { data: before } = await supabase
    .from("prds")
    .select("status, created_by, project_id, token")
    .eq("id", id)
    .single();

  if (!before) return { error: "PRD not found." };
  if (before.created_by !== profile.id) return { error: "Not your PRD." };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.content !== undefined) patch.content = parsed.data.content;

  const { error } = await supabase.from("prds").update(patch).eq("id", id);
  if (error) return { error: error.message };

  revalidatePrd(before.project_id as string, id, before.token as string | null);
  return { success: true };
}

export async function sendPrd(id: string): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can send a PRD." };

  const supabase = await getClient(profile.id);
  const { data: before } = await supabase
    .from("prds")
    .select("status, created_by, project_id, token")
    .eq("id", id)
    .single();

  if (!before) return { error: "PRD not found." };
  if (before.created_by !== profile.id) return { error: "Not your PRD." };
  if (before.status !== "draft") return { error: "Only drafts can be sent." };

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("prds")
    .update({ status: "sent", sent_at: now, updated_at: now })
    .eq("id", id);
  if (error) return { error: error.message };

  // Surface the PRD in the client's portal right away when it's unambiguous who
  // that client is (see connectProjectToClientOnSend).
  await connectProjectToClientOnSend(before.project_id as string, profile.id);

  revalidatePrd(before.project_id as string, id, before.token as string | null);
  return { success: true };
}

export async function deletePrd(id: string): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can delete a PRD." };

  const supabase = await getClient(profile.id);
  const { data: before } = await supabase
    .from("prds")
    .select("status, created_by, project_id")
    .eq("id", id)
    .single();

  if (!before) return { error: "PRD not found." };
  if (before.created_by !== profile.id) return { error: "Not your PRD." };
  if (before.status !== "draft") return { error: "Only drafts can be deleted." };

  const { error } = await supabase.from("prds").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(`/b/projects/${before.project_id as string}`);
  return { success: true };
}

// Revokes the public share link — the public lookup rejects a revoked row
// (migration 0062), killing access via any already-shared link.
export async function revokePrdShareLink(
  id: string
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can revoke a link." };

  const supabase = await getClient(profile.id);
  const { data: before } = await supabase
    .from("prds")
    .select("created_by, project_id")
    .eq("id", id)
    .maybeSingle();

  if (!before) return { error: "PRD not found." };
  if (before.created_by !== profile.id) return { error: "Not your PRD." };

  const { error } = await supabase
    .from("prds")
    .update({ token_revoked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(`/b/projects/${before.project_id as string}`);
  return { success: true };
}

export async function getPrdsByProject(projectId: string): Promise<Prd[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];

  const supabase = await getClient(profile.id);
  // Owner-scoped (created_by == project owner). RLS enforces this for the normal
  // client; the dev admin client bypasses RLS, so we replicate the scope here.
  const { data } = await supabase
    .from("prds")
    .select("*")
    .eq("project_id", projectId)
    .eq("created_by", profile.id)
    .order("created_at", { ascending: false });

  return (data ?? []) as Prd[];
}

export async function getPrdById(id: string): Promise<Prd | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const supabase = await getClient(profile.id);
  // Owner-scoped: the dev admin client bypasses RLS, so guard by created_by here.
  const { data } = await supabase
    .from("prds")
    .select("*")
    .eq("id", id)
    .eq("created_by", profile.id)
    .maybeSingle();
  return (data ?? null) as Prd | null;
}
