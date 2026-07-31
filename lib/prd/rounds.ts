import { SCOPE_STAGE_COUNT } from "@/lib/prd/scope-stages";

// The PRD interview's round math — the single source of truth shared by the server
// (draft-core's forceFinal decision) and the wizard (which routes the terminal
// GENERATION round to a durable background run instead of a blocking loading
// screen). Kept here, isomorphic (no server-only imports), so the client can call
// isPrdGenerationRound without duplicating the thresholds.

/** Hard cap on adaptive question rounds before a PRD is forced (notes provided). */
export const MAX_PRD_ROUNDS = 5;

/** No-notes "deep context" path: the opener round (round 0) plus one round per
    fixed scope stage, then force the PRD. */
export const MAX_PRD_ROUNDS_DEEP = SCOPE_STAGE_COUNT + 1;

/**
 * True when this round is the deterministic force-final generation round — the one
 * long unattended step the wizard backgrounds. Mirrors draft-core's `forceFinal`.
 * (A model can also finalize a PRD early on a non-forced round; that path stays
 * inline — it's not predictable here, and it renders live.)
 */
export function isPrdGenerationRound(input: { round: number; deepMode: boolean }): boolean {
  return input.round >= (input.deepMode ? MAX_PRD_ROUNDS_DEEP : MAX_PRD_ROUNDS);
}
