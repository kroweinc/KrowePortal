/* The fixed step-by-step "no-scope" intake backbone for the PRD wizard.
   When a builder starts a PRD with no usable notes (see PrdIntakeMode below), the
   interview walks these stages IN ORDER — one round each — instead of letting the
   model freely decide what to ask. With NO notes at all it opens with a single
   free-text OPENER ("what's your idea?") as its own round first; with notes too
   thin to specify anything, those notes stand in for the opener. Either way the
   idea is on record BEFORE the stages run, so every staged round (and the final
   PRD) is generated with that idea in hand rather than guessing generically.
   The model still generates the specific questions within a stage; this just
   guarantees the legible progression (idea → users → flows → security). Kept in
   a plain (non-"use client") module with no server-only imports so BOTH the
   server (generate-prd.ts / prds.ts) and the client wizard (prd-wizard.tsx) can
   import it as the single source of truth. */

export interface ScopeStage {
  /** Stable key for the stage. */
  key: "idea" | "users" | "flows" | "security";
  /** Short, builder-facing label shown in the "Step N of M" indicator. */
  label: string;
  /** What this stage's questions must cover — injected into the system prompt. */
  focus: string;
}

/** Deep-context round 0: the fixed free-text seed asked BEFORE the staged rounds,
    so the builder's idea is on record and every later question can build on it.
    Served instantly (no AI call) since the question never changes. */
export const SCOPE_OPENER = { key: "opener", label: "Your idea" } as const;

export const SCOPE_STAGES: readonly ScopeStage[] = [
  {
    key: "idea",
    label: "Idea & problem",
    focus:
      "what the product is in plain terms, the core problem it solves, and the single most important outcome",
  },
  {
    key: "users",
    label: "Users & roles",
    focus: "who uses it, the distinct user roles/groups, and what each role can do",
  },
  {
    key: "flows",
    label: "User flows",
    focus:
      "the key end-to-end journeys — the steps and screens a user moves through from first touch to done",
  },
  {
    key: "security",
    label: "Security & constraints",
    focus:
      "authentication, data sensitivity / compliance, and the hard constraints — especially the EXACT go-live date, the budget tier, and branding",
  },
] as const;

/** Number of fixed stages — the "Step N of M" denominator (the opener is a
    separate, unnumbered lead-in and is NOT counted here). */
export const SCOPE_STAGE_COUNT = SCOPE_STAGES.length;

/**
 * How a PRD gathers its scope, decided from the builder's written notes:
 *  - "deep"   — no notes at all: the fixed opener ("what's your idea?") as round 0,
 *               then one round per stage.
 *  - "seeded" — notes too thin to define a product ("an internal CRM"): the SAME
 *               staged intake, but those notes stand in for the opener answer so the
 *               builder is never asked to restate the idea they just typed.
 *  - "notes"  — a substantive brief: the adaptive interview, which picks its own
 *               questions from what the notes leave open.
 *
 * The "seeded" mode exists because the mode used to be a bare presence check on the
 * notes string. That inverted the flow: an empty box bought the full staged backbone,
 * while three words bought a fully model-discretionary interview that could — and did —
 * skip straight to a finished, largely invented PRD. Thin notes are the case that needs
 * the MOST interviewing, not the least.
 */
export type PrdIntakeMode = "deep" | "seeded" | "notes";

/** Word count at or above which notes count as a real brief. Below it the notes name a
    product category at best ("an internal CRM", "a booking site for salons") and can't
    ground a PRD on their own, so the staged intake runs instead. */
export const SUBSTANTIVE_NOTES_MIN_WORDS = 25;

export function notesWordCount(notes?: string | null): number {
  const trimmed = (notes ?? "").trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function resolveIntakeMode(notes?: string | null): PrdIntakeMode {
  const words = notesWordCount(notes);
  if (words === 0) return "deep";
  return words < SUBSTANTIVE_NOTES_MIN_WORDS ? "seeded" : "notes";
}

/** True when the mode walks the fixed stage backbone rather than the adaptive interview. */
export function isStagedMode(mode: PrdIntakeMode): boolean {
  return mode !== "notes";
}

/** Map a round to its scope-stage index, or null when the round isn't a staged one —
    the "deep" opener at round 0, or any round of the adaptive "notes" interview.
    "deep" spends round 0 on the opener so its stages start at round 1; "seeded" already
    has the idea in the notes, so its stages start at round 0. Clamped: a round past the
    last stage maps to the last stage (forceFinal fires before that in practice). */
export function stageIndexForRound(mode: PrdIntakeMode, round: number): number | null {
  if (mode === "notes") return null;
  const offset = mode === "deep" ? 1 : 0;
  if (round < offset) return null;
  return Math.min(round - offset, SCOPE_STAGES.length - 1);
}

/** Hard cap on adaptive question rounds before a PRD is forced. */
export const MAX_PRD_ROUNDS = 5;
/** "deep": the opener round (round 0) plus one round per fixed scope stage. */
export const MAX_PRD_ROUNDS_DEEP = SCOPE_STAGE_COUNT + 1;
/** "seeded": the notes already stand in for the opener, so it's one round per stage. */
export const MAX_PRD_ROUNDS_SEEDED = SCOPE_STAGE_COUNT;

/**
 * The FLOOR on the adaptive ("notes") interview: rounds the model must spend asking
 * before it may finalize. MAX_PRD_ROUNDS is only a ceiling, and for a long time it was
 * the only bound that existed — so nothing stopped the model from answering round 0 with
 * a finished PRD. It did exactly that, turning a three-word note into a complete,
 * wholly-invented document with the builder never asked a single question.
 *
 * Two rounds is 4–10 questions. A genuinely rich brief isn't interrogated about what it
 * already states: the prompt calls re-asking a failure and dedupeQuestions enforces it,
 * so the floor costs a well-prepared builder one round of questions about what their
 * notes left open — which is the point.
 */
export const MIN_PRD_ROUNDS = 2;

export function maxRoundsFor(mode: PrdIntakeMode): number {
  if (mode === "deep") return MAX_PRD_ROUNDS_DEEP;
  if (mode === "seeded") return MAX_PRD_ROUNDS_SEEDED;
  return MAX_PRD_ROUNDS;
}

/** Everything a generation round's shape is decided by, derived from just the builder's
    notes and how many rounds they've answered. Pure — kept out of the server-only
    draft-core so the policy (which rounds must ask, which force the PRD) is testable and
    lives next to the stage backbone it's describing. */
export type PrdRoundPlan = {
  mode: PrdIntakeMode;
  /** Staged intake: run the scope backbone and synthesize a reusable context summary. */
  deepContext: boolean;
  /** Thin notes stand in for the opener answer — nothing beyond that one line is known. */
  seeded: boolean;
  /** The fixed free-text opener, served without an AI call. */
  openerRound: boolean;
  /** Must return a finished PRD; may not ask. */
  forceFinal: boolean;
  /** Must ask; may not finalize. The floor — see MIN_PRD_ROUNDS. */
  mustAsk: boolean;
  /** Which fixed scope stage this round covers, if it is a staged round. */
  stageIndex?: number;
};

export function planPrdRound(notes: string | undefined | null, round: number): PrdRoundPlan {
  const mode = resolveIntakeMode(notes);
  const forceFinal = round >= maxRoundsFor(mode);
  const stageIndex = stageIndexForRound(mode, round) ?? undefined;
  return {
    mode,
    deepContext: mode !== "notes",
    seeded: mode === "seeded",
    openerRound: mode === "deep" && round === 0,
    forceFinal,
    // Every staged round is a question round by construction — the stage names what to
    // ask — and the adaptive interview owes the builder MIN_PRD_ROUNDS of questions
    // before it may finalize. forceFinal wins on the last round, so the two are never
    // both set.
    mustAsk: !forceFinal && (stageIndex != null || round < MIN_PRD_ROUNDS),
    stageIndex,
  };
}

/** The stage at a given stage index (clamped into range). */
export function scopeStageAt(index: number): ScopeStage {
  const i = Math.min(Math.max(index, 0), SCOPE_STAGES.length - 1);
  return SCOPE_STAGES[i];
}
