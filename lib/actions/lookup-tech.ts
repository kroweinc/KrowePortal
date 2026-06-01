"use server";

import { getCurrentProfile } from "@/lib/auth";
import { lookupStackItem, lookupIntegrationItem } from "@/lib/ai/lookup-stack-item";
import type { StackLookup, IntegrationLookup } from "@/lib/ai/lookup-stack-item";
import { reconcileTechReferences } from "@/lib/ai/reconcile-tech-references";
import type { PrdContent } from "@/lib/types";

/* Pure AI lookups for the PRD tech-stack (§9) and integrations (§8) cards.
   No DB writes — the client merges the result into the in-memory PRD content and
   saves on the existing Save flow. Builder-only. */

export async function lookupStackItemAction(
  name: string,
  context?: string
): Promise<{ data: StackLookup } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "builder") return { error: "Not authorized." };
  if (!name || name.trim().length < 2) return { error: "Name too short." };

  try {
    const data = await lookupStackItem(name, context);
    const empty =
      !data || (!data.provider && !data.category && !data.layer && !data.includes.length && !data.monthlyCost);
    if (empty) return { error: `No details found for "${name.trim()}".` };
    return { data };
  } catch {
    return { error: "Lookup failed." };
  }
}

export async function lookupIntegrationItemAction(
  name: string,
  context?: string
): Promise<{ data: IntegrationLookup } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "builder") return { error: "Not authorized." };
  if (!name || name.trim().length < 2) return { error: "Name too short." };

  try {
    const data = await lookupIntegrationItem(name, context);
    if (!data || (!data.purpose && !data.monthlyCost)) return { error: `No details found for "${name.trim()}".` };
    return { data };
  } catch {
    return { error: "Lookup failed." };
  }
}

/** After a §9 tech-stack item is renamed, surface the exact phrases elsewhere in the
    PRD that still name the OLD technology (other name forms, the same tool in §8,
    prose) so the client can deterministically swap each to the new name. Returns an
    empty list when nothing relevant remains — never throws to the caller. */
export async function reconcileTechReferencesAction(
  oldName: string,
  newName: string,
  content: PrdContent
): Promise<{ data: string[] } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "builder") return { error: "Not authorized." };

  const from = (oldName ?? "").trim();
  const to = (newName ?? "").trim();
  if (from.length < 2 || to.length < 2 || from.toLowerCase() === to.toLowerCase()) return { data: [] };

  try {
    const mentions = await reconcileTechReferences(from, to, JSON.stringify(content ?? {}));
    return { data: mentions };
  } catch {
    return { error: "Reconcile failed." };
  }
}
