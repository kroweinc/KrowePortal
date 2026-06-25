/* The fixed step-by-step "no-scope" intake backbone for the PRD wizard.
   When a builder starts a PRD with NO notes (deepContext), the interview opens
   with a single free-text OPENER ("what's your idea?") as its own round, THEN
   walks these stages IN ORDER — one round each — instead of letting the model
   freely decide what to ask. Splitting the opener out means the idea answer is
   captured FIRST, so every staged round (and the final PRD) is generated with
   that idea already in hand and builds on it rather than guessing generically.
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

/** Map a deep-context round to its scope-stage index, or null for the opener
    round (round 0). Round 1 → stage 0, round 2 → stage 1, … (clamped). */
export function deepStageIndex(round: number): number | null {
  if (round <= 0) return null;
  return Math.min(round - 1, SCOPE_STAGES.length - 1);
}

/** The stage at a given stage index (clamped into range). */
export function scopeStageAt(index: number): ScopeStage {
  const i = Math.min(Math.max(index, 0), SCOPE_STAGES.length - 1);
  return SCOPE_STAGES[i];
}
