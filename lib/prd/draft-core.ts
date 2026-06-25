/**
 * PRD draft core — the auth/setup/save logic shared by the blocking `draftPrd`
 * server action (lib/actions/prds.ts) and the streaming route handler
 * (app/api/ai/prd/stream/route.ts). Kept OUT of the "use server" action file so
 * these can be plain server-only helpers (not exposed as client-callable RPC) and
 * so the zod schema can be exported as a value. Server-only — never import from a
 * client component (uses cookies, the service-role client, revalidate).
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { getProjectById } from "@/lib/actions/projects";
import { getProjectMaterials } from "@/lib/actions/project-materials";
import { getProjectSopTranscripts } from "@/lib/actions/project-sop";
import { composeBusinessContext } from "@/lib/project/business-context";
import { assertAiBudget } from "@/lib/ai/usage";
import { analyzeFreeTierFit, stackServiceNames } from "@/lib/ai/free-tier-fit";
import type { PrdGenInput } from "@/lib/ai/generate-prd";
import { SCOPE_STAGE_COUNT, deepStageIndex } from "@/lib/prd/scope-stages";
import type { Question } from "@/lib/ai/schemas";
import type { PrdContent } from "@/lib/types";

/** Hard cap on adaptive question rounds before a PRD is forced. */
const MAX_PRD_ROUNDS = 5;
/** No-notes "deep context" path: the opener round (round 0) plus one round per
    fixed scope stage, then force the PRD. */
const MAX_PRD_ROUNDS_DEEP = SCOPE_STAGE_COUNT + 1;

export async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : await createClient();
}

/**
 * True when a generated PRD carries no substantive content. PrdContentSchema makes
 * EVERY field optional/defaulted, so an empty `{}` (and the `{ content: {} }` the
 * empty-draft fallback emits on a truncated/failed final round) validates as a
 * "valid" PRD. Persisting that hands the builder a blank document with no error —
 * the exact "blank PRD after no follow-up questions" failure. Callers treat an
 * empty result as a generation failure (surface a retry) instead of saving it.
 * Checks the load-bearing sections; the all-empty default arrays don't count.
 */
export function isEmptyPrdContent(content: PrdContent | undefined | null): boolean {
  if (!content) return true;
  const hasText = (s?: string) => !!s && s.trim().length > 0;
  const hasItems = (a?: unknown[]) => Array.isArray(a) && a.length > 0;
  return !(
    hasText(content.overview) ||
    hasItems(content.goals) ||
    hasItems(content.users) ||
    hasItems(content.coreUserFlow) ||
    hasItems(content.features) ||
    hasItems(content.requirements) ||
    hasItems(content.pagesScreens) ||
    hasItems(content.successCriteria) ||
    hasItems(content.techStack) ||
    hasItems(content.integrations)
  );
}

/**
 * Best-effort Free-Tier Fit (§15) computed at generation time so a freshly drafted
 * or regenerated PRD already ships with its free-tier verdicts. Returns the content
 * untouched when there's no billable stack to assess or the AI call fails: PRD
 * creation must never hinge on this side analysis.
 */
export async function withFreeTierAnalysis(content: PrdContent): Promise<PrdContent> {
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

export const draftPrdSchema = z.object({
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

export type DraftPrdInput = z.input<typeof draftPrdSchema>;

export type DraftPrdResult =
  | { kind: "questions"; items: Question[] }
  | { kind: "prd"; prdId: string }
  | { error: string };

type Profile = NonNullable<Awaited<ReturnType<typeof getCurrentProfile>>>;
type Project = NonNullable<Awaited<ReturnType<typeof getProjectById>>>;
type PrdAnswerRow = { questionId: string; question: string; answer: string };

/** Everything persistPrdDraft needs to save a finished PRD — captured once during
    resolution so the blocking action and the streaming route save identically. */
export type PrdSaveContext = {
  profile: Profile;
  project: Project;
  projectId: string;
  title: string;
  notes?: string;
  answers: PrdAnswerRow[];
  deepContext: boolean;
};

export type PrdDraftResolution =
  | { ok: false; status: number; error: string }
  | {
      ok: true;
      profile: Profile;
      genInput: PrdGenInput;
      save: PrdSaveContext;
      /** Deep-context round 0: the caller serves the fixed opener question
          directly and skips the AI generation entirely. */
      openerRound: boolean;
    };

/**
 * Shared setup for a PRD generation round: auth, validation, ownership, the
 * concurrent project reads, the AI budget gate, and the deep-context / forceFinal
 * decision. Returns the generator input plus the save context.
 */
export async function resolvePrdDraft(input: DraftPrdInput): Promise<PrdDraftResolution> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, status: 401, error: "Not signed in." };
  if (profile.role !== "builder") return { ok: false, status: 403, error: "Only builders can create PRDs." };

  const parsed = draftPrdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const { projectId, title, notes, answers = [], round } = parsed.data;

  const project = await getProjectById(projectId);
  if (!project) return { ok: false, status: 404, error: "Document not found." };
  if (project.owner_id !== profile.id) return { ok: false, status: 403, error: "Not your document." };

  // These three reads are independent — run them concurrently rather than serially.
  const [materials, sopTranscripts, budget] = await Promise.all([
    getProjectMaterials(projectId),
    getProjectSopTranscripts(projectId),
    assertAiBudget(profile.id),
  ]);
  if (!budget.ok) return { ok: false, status: 429, error: budget.error };

  // No written notes ⇒ deep context-gathering mode: a fixed step-by-step scope
  // intake (round 0 is the free-text opener, then one stage per round), and a
  // synthesized context summary saved back to the project. The opener round is
  // served as a fixed question by the caller (no AI call); `stageIndex` maps the
  // staged rounds (1..N) to their scope stage and is undefined for the opener.
  const deepContext = !(notes && notes.trim().length > 0);
  const openerRound = deepContext && round === 0;
  const forceFinal = round >= (deepContext ? MAX_PRD_ROUNDS_DEEP : MAX_PRD_ROUNDS);
  const stageIndex = deepContext ? (deepStageIndex(round) ?? undefined) : undefined;

  const genInput: PrdGenInput = {
    title,
    notes,
    businessContext: composeBusinessContext(project, materials, sopTranscripts),
    answers: answers.map((a) => ({ question: a.question, answer: a.answer })),
    forceFinal,
    deepContext,
    stageIndex,
    currentDate: new Date().toISOString().slice(0, 10),
  };

  return {
    ok: true,
    profile,
    genInput,
    save: { profile, project, projectId, title, notes, answers, deepContext },
    openerRound,
  };
}

/**
 * Persist a finished PRD draft: compute the Free-Tier Fit (§15) analysis, insert
 * the row already carrying its verdicts, and write back the synthesized business
 * context (deep path, when the project has none). Returns the new id. Shared by the
 * action and the streaming route so a streamed generation is saved exactly once.
 */
export async function persistPrdDraft(
  save: PrdSaveContext,
  content: PrdContent,
  contextSummary?: string
): Promise<{ prdId: string } | { error: string }> {
  const { profile, project, projectId, title, notes, answers, deepContext } = save;

  // Never persist a blank PRD. A truncated/failed final round degrades to an empty
  // `{ content: {} }` (and a model can finalize early with nothing), which the
  // all-optional schema accepts — saving it would navigate the builder to an empty
  // document with no error. Surface a retryable failure instead so the wizard
  // toasts + rolls back rather than presenting a hollow draft as success.
  if (isEmptyPrdContent(content)) {
    return { error: "The PRD came back empty — generation didn't finish. Please try again." };
  }

  const transcript = answers.length
    ? answers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join("\n\n")
    : "";
  const sourceNotes = [notes?.trim(), transcript].filter(Boolean).join("\n\n---\n\n") || null;

  // Run Free-Tier Fit (§15) inline so a freshly drafted PRD ships with its verdicts
  // already present — the builder lands in the editor with the analysis filled in,
  // never an empty section waiting on a button. withFreeTierAnalysis is fully
  // self-contained (no billable stack ⇒ no-op; AI failure ⇒ returns content
  // unchanged), so PRD creation never hinges on it. The streaming route awaits this
  // before emitting "done", and the wizard's progress bar covers the extra seconds.
  const finalContent = await withFreeTierAnalysis(content);

  const supabase = await getClient(profile.id);
  const { data, error } = await supabase
    .from("prds")
    .insert({
      project_id: projectId,
      created_by: profile.id,
      title,
      status: "draft",
      content: finalContent,
      source_notes: sourceNotes,
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Failed to create PRD." };
  const prdId = data.id as string;

  // Deep-context path: persist the synthesized business context to the project so
  // future documents start warm. Only when the project has no context yet — never
  // clobber what the builder already wrote. Best-effort.
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
  return { prdId };
}
