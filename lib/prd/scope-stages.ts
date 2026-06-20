/* The fixed step-by-step "no-scope" intake backbone for the PRD wizard.
   When a builder starts a PRD with NO notes (deepContext), the interview walks
   these stages IN ORDER — one round each — instead of letting the model freely
   decide what to ask. The model still generates the specific questions within a
   stage; this just guarantees the legible progression (idea → users → flows →
   security). Kept in a plain (non-"use client") module with no server-only
   imports so BOTH the server (generate-prd.ts / prds.ts) and the client wizard
   (prd-wizard.tsx) can import it as the single source of truth. */

export interface ScopeStage {
  /** Stable key for the stage. */
  key: "idea" | "users" | "flows" | "security";
  /** Short, builder-facing label shown in the "Step N of M" indicator. */
  label: string;
  /** What this stage's questions must cover — injected into the system prompt. */
  focus: string;
  /** The first stage opens the interview with the free-text "what's your idea?". */
  opener?: boolean;
}

export const SCOPE_STAGES: readonly ScopeStage[] = [
  {
    key: "idea",
    label: "Idea & problem",
    focus:
      "what the product is in plain terms, the core problem it solves, and the single most important outcome",
    opener: true,
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

/** Number of fixed stages — the deep-context round cap and the "Step N of M". */
export const SCOPE_STAGE_COUNT = SCOPE_STAGES.length;

/** The stage for a given round (clamped), so round N maps to stage N. */
export function stageForRound(round: number): ScopeStage {
  const i = Math.min(Math.max(round, 0), SCOPE_STAGES.length - 1);
  return SCOPE_STAGES[i];
}
