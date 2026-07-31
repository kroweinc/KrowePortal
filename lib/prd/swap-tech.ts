/* The pure core of the agent's swap_prd_tech tool: replace one technology with
   another across a PRD's content. Kept apart from the tool (lib/agent/doc-tools.ts)
   so the load-bearing transform is unit-testable without a DB or the AI seams — the
   tool passes the AI results in and this just composes them, mirroring how the
   inline tech-stack editor (prd-sections.tsx) cascades a rename.

   Plain module (no "use client"/"server-only"): only pure helpers + type imports. */

import { renameTechAcrossPrd } from "./rename-tech";
import { fillStack } from "./fill-lookup";
import type { PrdContent } from "@/lib/types";
import type { StackLookup } from "@/lib/ai/lookup-stack-item";

export interface TechSwapResult {
  content: PrdContent;
  /** Did the rename touch anything? False means the PRD never named `from`, so the
      caller can skip the write and tell the builder there was nothing to swap. */
  changed: boolean;
}

/** Every technology name the PRD actually uses — §9 stack rows and §8 integrations.
    The swap's `from` is matched against these so a builder's loose spelling resolves
    to the row's real name before the rename runs. */
function prdTechNames(content: PrdContent): string[] {
  const names: string[] = [];
  for (const s of content.techStack ?? []) if (typeof s?.name === "string" && s.name.trim()) names.push(s.name.trim());
  for (const s of content.integrations ?? []) if (typeof s?.name === "string" && s.name.trim()) names.push(s.name.trim());
  return names;
}

const normTech = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Resolve a loosely-typed `from` to the technology name the PRD actually uses, so
 * "Postgres" swaps the §9 row named "PostgreSQL". Returns the matched canonical name,
 * or `from` unchanged when there's no confident single match.
 *
 * This is what makes the primary row swap deterministic instead of leaning on the
 * best-effort LLM reconcile pass: the word-boundary cascade alone can't bridge
 * "Postgres" → "PostgreSQL" (the trailing "QL" blocks the boundary), so a swap that
 * named the tech slightly differently than the row silently changed nothing. It
 * mirrors the inline editor, which always renames from the row's own real name.
 */
export function resolveTechName(content: PrdContent, from: string): string {
  const q = from.trim();
  if (q.length < 2) return q;
  const names = prdTechNames(content);
  // 1) Exact (case-insensitive) — the builder already named the row.
  const exact = names.find((n) => n.toLowerCase() === q.toLowerCase());
  if (exact) return exact;
  const qn = normTech(q);
  if (qn.length < 2) return q;
  // 2) Normalized equality ("Next.js" ↔ "nextjs", "Postgres SQL" ↔ "PostgreSQL").
  const normEq = names.filter((n) => normTech(n) === qn);
  if (normEq.length === 1) return normEq[0];
  // 3) One normalized name is a prefix of the other, shorter side ≥ 4 chars
  //    ("postgres" ⊂ "postgresql"). The ≥ 4 floor keeps "Go"/"AWS" from over-matching.
  //    A single confident hit wins; ambiguity falls back to the typed form.
  const prefixHits = names.filter((n) => {
    const nn = normTech(n);
    const [short, long] = qn.length <= nn.length ? [qn, nn] : [nn, qn];
    return short.length >= 4 && long.startsWith(short);
  });
  if (prefixHits.length === 1) return prefixHits[0];
  return q;
}

/**
 * Rename `from` → `to` everywhere in a PRD (the deterministic word-boundary cascade
 * shared with the inline editor), then cascade any `reconciled` alternate-name forms
 * of `from` (e.g. "PostgreSQL" when the builder said "Postgres") the same way.
 * Returns the new content and whether anything changed. The input is left untouched.
 *
 * The builder's `from` is first resolved to the tech name the PRD actually uses
 * (see resolveTechName) so a loose spelling still swaps the real §9 row; the typed
 * form is then cascaded too, catching prose that used the builder's spelling.
 */
export function applyTechSwap(
  before: PrdContent,
  from: string,
  to: string,
  reconciled: string[] = []
): TechSwapResult {
  const canonical = resolveTechName(before, from);
  let next = renameTechAcrossPrd(before, canonical, to);
  // Also cascade the builder's typed spelling when it differs from the row's real
  // name, so prose that used "Postgres" is swapped alongside the "PostgreSQL" row.
  if (canonical.toLowerCase() !== from.trim().toLowerCase()) {
    next = renameTechAcrossPrd(next, from, to);
  }
  if (reconciled.length) next = renameTechAcrossPrd(next, reconciled, to);
  const changed = JSON.stringify(next) !== JSON.stringify(before);
  return { content: changed ? next : before, changed };
}

/**
 * Re-fill every §9 stack row now named `to` with the new tool's looked-up facts
 * (provider, layer, logo, rate), so a swapped row doesn't keep the retired tool's
 * stale metadata. Rows keep their own values wherever the lookup returned nothing.
 */
export function fillSwappedRows(content: PrdContent, to: string, lookup: StackLookup): PrdContent {
  const toKey = to.trim().toLowerCase();
  return {
    ...content,
    techStack: (content.techStack ?? []).map((it) =>
      (it.name ?? "").trim().toLowerCase() === toKey ? fillStack(it, lookup) : it
    ),
  };
}
