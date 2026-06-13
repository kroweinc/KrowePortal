/* Maps each refinable Quote section to the QuoteContent keys it owns.
   Shared by the server action, the AI refine function, and the client dialog —
   kept in a plain (non-"use client") module so the server can import it too.
   ids align with the refinable section blocks in quote-sections.tsx; computed /
   display-only sections (e.g. Cost Overview) are intentionally excluded — they
   have no directly-editable source keys to rewrite. */

import type { QuoteContent } from "@/lib/types";

export interface RefinableSection {
  id: string;
  title: string;
  /** The QuoteContent keys this section is allowed to rewrite. */
  fields: (keyof QuoteContent)[];
}

export const QUOTE_SECTIONS: RefinableSection[] = [
  { id: "header", title: "Header", fields: ["companyName", "clientName", "productSubtitle"] },
  { id: "scopeSummary", title: "Scope Summary", fields: ["scopeSummary"] },
  { id: "modules", title: "Cost Breakdown", fields: ["modules"] },
  { id: "designSystem", title: "Design System Included", fields: ["designSystem"] },
  { id: "paymentMilestones", title: "Payment Structure", fields: ["paymentMilestones"] },
  { id: "justification", title: "Why This Price Is Justified", fields: ["justification"] },
  { id: "scopeProtection", title: "Scope Protection", fields: ["scopeProtection"] },
  { id: "footerNote", title: "Footer Note", fields: ["footerNote"] },
];

export const SECTION_FIELDS: Record<string, (keyof QuoteContent)[]> = Object.fromEntries(
  QUOTE_SECTIONS.map((s) => [s.id, s.fields])
);

export function fieldsForSection(id: string): (keyof QuoteContent)[] {
  return SECTION_FIELDS[id] ?? [];
}

export function refinableSection(id: string): RefinableSection | undefined {
  return QUOTE_SECTIONS.find((s) => s.id === id);
}

export function isRefinable(id: string): boolean {
  return id in SECTION_FIELDS;
}
