"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getProjectById } from "@/lib/actions/projects";
import { getProjectMaterials } from "@/lib/actions/project-materials";
import { getProjectSopTranscripts } from "@/lib/actions/project-sop";
import { composeBusinessContext } from "@/lib/project/business-context";
import { generatePrd, OPENER_QUESTION } from "@/lib/ai/generate-prd";
import { assertAiBudget } from "@/lib/ai/usage";
import { getCurrentProfile } from "@/lib/auth";
import { refinePrdSection as runRefineSection } from "@/lib/ai/refine-prd-section";
import { connectProjectToClientOnSend } from "@/lib/actions/connect-project";
import { fieldsForSection, refinableSection } from "@/lib/prd/section-fields";
import type { Question } from "@/lib/ai/schemas";
import { PrdContentSchema } from "@/lib/ai/schemas";
import type { Prd, PrdContent, PrdSummary } from "@/lib/types";

// Columns for list/summary reads — every Prd field except the heavy `content`
// jsonb, which PRD list rows don't render (docMeta reads only dates/status).
const PRD_SUMMARY_COLUMNS =
  "id, project_id, created_by, title, status, source_notes, token, sent_at, signed_by_name, signed_at, signer_ip, signature_consent, signed_by_user_id, rejected_at, rejection_note, created_at, updated_at";
import {
  getClient,
  withFreeTierAnalysis,
  isEmptyPrdContent,
  resolvePrdDraft,
  persistPrdDraft,
  type DraftPrdInput,
  type DraftPrdResult,
} from "@/lib/prd/draft-core";

/** Hard cap on refine question rounds before a section patch is forced. */
const MAX_REFINE_ROUNDS = 2;

function revalidatePrd(projectId: string, id: string, token?: string | null) {
  revalidatePath(`/b/projects/${projectId}`);
  revalidatePath(`/b/projects/${projectId}/prd/${id}`);
  if (token) revalidatePath(`/prd/${token}`);
}

/**
 * Adaptive PRD wizard step. Reads notes + accumulated answers and either asks
 * another round of clarifying questions or generates + inserts the finished
 * PRD draft (returning its id for the client to redirect to). The streaming route
 * (app/api/ai/prd/stream) reuses resolvePrdDraft + persistPrdDraft from the shared
 * core so a streamed generation is saved identically and exactly once.
 */
export async function draftPrd(input: DraftPrdInput): Promise<DraftPrdResult> {
  const resolved = await resolvePrdDraft(input);
  if (!resolved.ok) {
    if (resolved.status === 401) redirect("/login");
    return { error: resolved.error };
  }

  // No-notes round 0: serve the fixed opener directly so the builder's idea is
  // captured before any questions are generated — no AI call, instant response.
  if (resolved.openerRound) {
    return { kind: "questions", items: [OPENER_QUESTION] };
  }

  let result;
  try {
    result = await generatePrd(resolved.genInput, { userId: resolved.profile.id, operation: "generate_prd" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI generation failed";
    return { error: msg };
  }

  if (result.kind === "questions") {
    return { kind: "questions", items: result.items };
  }

  // Empty finalized PRD (an early finalize with nothing, or a final round that
  // degraded to a blank draft) — retry once with forceFinal before refusing, so a
  // transient empty result self-heals rather than erroring the builder out. Mirrors
  // the streaming route's recovery; persistPrdDraft still refuses a persistent blank.
  if (isEmptyPrdContent(result.content)) {
    try {
      result = await generatePrd(
        { ...resolved.genInput, forceFinal: true },
        { userId: resolved.profile.id, operation: "generate_prd" }
      );
    } catch (err) {
      return { error: err instanceof Error ? err.message : "AI generation failed" };
    }
    if (result.kind !== "prd") return { error: "The PRD came back empty — generation didn't finish. Please try again." };
  }

  const saved = await persistPrdDraft(resolved.save, result.content, result.contextSummary);
  if ("error" in saved) return { error: saved.error };
  return { kind: "prd", prdId: saved.prdId };
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
  // Don't overwrite the existing draft with a blank: a failed/truncated final
  // round degrades to empty content, which the all-optional schema would accept
  // and silently wipe the builder's PRD. Bail with a retryable error instead.
  if (result.kind !== "prd" || isEmptyPrdContent(result.content)) {
    return { error: "The PRD came back empty — generation didn't finish. Please try again." };
  }
  const content = await withFreeTierAnalysis(result.content);

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
    .select("created_by, project_id, token")
    .eq("id", id)
    .maybeSingle();

  if (!before) return { error: "PRD not found." };
  if (before.created_by !== profile.id) return { error: "Not your PRD." };

  const { error } = await supabase
    .from("prds")
    .update({ token_revoked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePrd(before.project_id as string, id, before.token as string | null);
  return { success: true };
}

// Mint a fresh share link: a new token (so old links stay dead), a reset expiry
// window, and a cleared revocation flag — the re-share path after revoke/expiry.
export async function reissuePrdShareLink(
  id: string
): Promise<{ success: true; token: string } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can reissue a link." };

  const supabase = await getClient(profile.id);
  const { data: before } = await supabase
    .from("prds")
    .select("created_by, project_id, token")
    .eq("id", id)
    .maybeSingle();

  if (!before) return { error: "PRD not found." };
  if (before.created_by !== profile.id) return { error: "Not your PRD." };

  // supabase-js can't invoke the SQL column default on update, so mint the
  // 64-hex token here. Reissued links never expire by default (null, per
  // migration 0064); clear any prior revocation so the fresh link works.
  const token = randomBytes(32).toString("hex");
  const { error } = await supabase
    .from("prds")
    .update({ token, token_expires_at: null, token_revoked_at: null })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePrd(before.project_id as string, id, before.token as string | null);
  revalidatePath(`/prd/${token}`);
  return { success: true, token };
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

// List-view variant: same scope/order as getPrdsByProject but omits the heavy
// `content` jsonb. Use for dashboard PRD lists; use getPrdsByProject (full) when
// content is needed (e.g. contract auto-fill via bestPrdContent).
export async function getPrdSummariesByProject(projectId: string): Promise<PrdSummary[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];

  const supabase = await getClient(profile.id);
  const { data } = await supabase
    .from("prds")
    .select(PRD_SUMMARY_COLUMNS)
    .eq("project_id", projectId)
    .eq("created_by", profile.id)
    .order("created_at", { ascending: false });

  return (data ?? []) as PrdSummary[];
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
