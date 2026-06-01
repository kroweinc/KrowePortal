/* Maps each refinable PRD section to the PrdContent keys it owns.
   Shared by the server action, the AI refine function, and the client dialog —
   kept in a plain (non-"use client") module so the server can import it too.
   The ids/titles mirror the SECTIONS registry in
   components/prd/dashboard/prd-sections.tsx. The computed "Free-Tier Fit"
   section is intentionally excluded — it has its own analyze action. */

import type { PrdContent } from "@/lib/types";

export interface RefinableSection {
  id: string;
  title: string;
  /** The PrdContent keys this section is allowed to rewrite. */
  fields: (keyof PrdContent)[];
}

export const REFINABLE_SECTIONS: RefinableSection[] = [
  { id: "overview", title: "Overview", fields: ["overview"] },
  { id: "goals", title: "Goals", fields: ["goals"] },
  { id: "successMetrics", title: "Success Metrics", fields: ["successMetrics"] },
  { id: "users", title: "Who It's For", fields: ["users", "targetUsers"] },
  { id: "coreUserFlow", title: "Core User Flow", fields: ["coreUserFlow"] },
  { id: "features", title: "Features", fields: ["features"] },
  { id: "requirements", title: "Functional Requirements", fields: ["requirements"] },
  { id: "pagesScreens", title: "Pages & Screens", fields: ["pagesScreens"] },
  { id: "successCriteria", title: "Success Criteria", fields: ["successCriteria"] },
  { id: "userStories", title: "User Stories", fields: ["userStories"] },
  {
    id: "nonFunctionalRequirements",
    title: "Non-Functional Requirements",
    fields: ["nonFunctionalRequirements"],
  },
  { id: "scopeLater", title: "Scope — Later", fields: ["scopeLater"] },
  { id: "futureExpansion", title: "Future Expansion", fields: ["futureExpansion"] },
  { id: "dataModel", title: "Data Model & Sources", fields: ["dataModel"] },
  { id: "integrations", title: "Integrations & 3rd-Party Software", fields: ["integrations"] },
  { id: "techStack", title: "Tech Stack & Infrastructure", fields: ["techStack"] },
  { id: "uxFlows", title: "UX Flows", fields: ["uxFlows"] },
  { id: "assumptions", title: "Assumptions", fields: ["assumptions"] },
  { id: "constraints", title: "Constraints", fields: ["constraintsDetail", "constraints"] },
  { id: "risks", title: "Risks & Open Questions", fields: ["risks", "openQuestions"] },
  { id: "milestoneList", title: "Milestones", fields: ["milestoneList"] },
];

export const SECTION_FIELDS: Record<string, (keyof PrdContent)[]> = Object.fromEntries(
  REFINABLE_SECTIONS.map((s) => [s.id, s.fields])
);

export function fieldsForSection(id: string): (keyof PrdContent)[] {
  return SECTION_FIELDS[id] ?? [];
}

export function refinableSection(id: string): RefinableSection | undefined {
  return REFINABLE_SECTIONS.find((s) => s.id === id);
}

export function isRefinable(id: string): boolean {
  return id in SECTION_FIELDS;
}
