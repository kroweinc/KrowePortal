/* Merge a tech-lookup result into a PRD §9 stack row or §8 integration row.

   When a technology is looked up by name (lib/ai/lookup-stack-item), the returned
   facts (provider, layer, what it covers, typical rate, brand domain) overwrite the
   row's fields, keeping the prior value only where the lookup returned nothing. Used
   both by the inline tech-stack editor (prd-sections.tsx, on rename) and by the
   agent's swap_prd_tech tool (lib/agent/doc-tools.ts, on a confirmed swap) — a single
   home so the "how a lookup fills a card" rule can't drift between the two.

   Kept as a plain (non-"use client", non-"server-only") module so both the client
   editor and the server tool can import it, mirroring lib/prd/rename-tech.ts. The
   lookup/type imports are type-only, so they carry no runtime dependency. */

import type { StackLookup, IntegrationLookup } from "@/lib/ai/lookup-stack-item";
import type { PrdStackItem, PrdIntegration } from "@/lib/types";

/** Overwrite a stack item with looked-up facts; keep prior values only where the
    lookup returned nothing. */
export function fillStack(it: PrdStackItem, f: StackLookup): PrdStackItem {
  return {
    ...it,
    provider: f.provider ?? it.provider ?? null,
    category: f.category ?? it.category ?? null,
    layer: f.layer ?? it.layer ?? null,
    includes: f.includes && f.includes.length ? f.includes : it.includes ?? [],
    monthlyCost: f.monthlyCost ?? it.monthlyCost ?? null,
    estimated: f.monthlyCost ? true : it.estimated,
    domain: f.domain ?? it.domain ?? null,
  };
}

export function fillIntegration(it: PrdIntegration, f: IntegrationLookup): PrdIntegration {
  return {
    ...it,
    purpose: f.purpose ?? it.purpose ?? null,
    monthlyCost: f.monthlyCost ?? it.monthlyCost ?? null,
    estimated: f.monthlyCost ? true : it.estimated,
    domain: f.domain ?? it.domain ?? null,
  };
}
