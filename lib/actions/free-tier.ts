"use server";

import { getCurrentProfile } from "@/lib/auth";
import { analyzeFreeTierFit, stackServiceNames } from "@/lib/ai/free-tier-fit";
import { assertAiBudget } from "@/lib/ai/usage";
import type { FreeTierAnalysis, PrdContent } from "@/lib/types";

/* Pure AI analysis for the PRD "Free-Tier Fit" (§15) section. No DB writes — the
   client merges the result into the in-memory PRD content and saves on the
   existing Save flow. Builder-only. */

export async function analyzeFreeTierFitAction(
  content: PrdContent
): Promise<{ data: FreeTierAnalysis } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "builder") return { error: "Not authorized." };

  const hasStack = (content.techStack?.length ?? 0) > 0;
  const hasIntegrations = (content.integrations?.length ?? 0) > 0;
  if (!hasStack && !hasIntegrations) {
    return { error: "Add tech stack or integration items first." };
  }

  const budget = await assertAiBudget(profile.id);
  if (!budget.ok) return { error: budget.error };

  try {
    // Pass any builder-edited assumptions from the prior run back as authoritative
    // so a re-check recomputes verdicts against the corrected numbers.
    const data = await analyzeFreeTierFit(
      content,
      content.scaleAssumptions,
      content.freeTierAnalysis?.assumptions,
      { userId: profile.id, operation: "free_tier_fit" }
    );
    if (!data.services.length) return { error: "Could not analyze the stack — try again." };
    data.analyzedAt = new Date().toISOString();
    data.analyzedStack = stackServiceNames(content);
    return { data };
  } catch {
    return { error: "Analysis failed." };
  }
}
