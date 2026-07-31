import "server-only";

import { Lines } from "@/lib/context/serialize-documents";
import type {
  BuilderProfile,
  BuilderProfileProject,
  BuilderProfileExperience,
  BuilderProfileCodingTool,
  BusinessContextCard,
} from "@/lib/types";

// ============================================================
// Render the two people in an engagement — the builder and the operator — into
// one readable, bounded plain-text document each. This is the text the Client
// Context Layer chunks + embeds when a profile is auto-synced (see
// sync-profile.ts), so keep sections stable and human-legible — it's what the
// RAG layer reads back and what previews on the builder/operator graph nodes.
//
// Both serializers return "" when there's nothing substantive beyond the bare
// name (just the heading line), so the caller never creates an empty mirror —
// mirroring serializeDocumentForContext returning empty text.
// ============================================================

/** True when the rendered text carries content past its single heading line. */
function hasBody(text: string): string {
  return text.split("\n").filter((l) => l.trim()).length > 1 ? text : "";
}

export interface BuilderProfileInput {
  profile: BuilderProfile;
  projects: BuilderProfileProject[];
  experience: BuilderProfileExperience[];
  codingTools: BuilderProfileCodingTool[];
}

export function serializeBuilderProfile(input: BuilderProfileInput): string {
  const { profile: p, projects, experience, codingTools } = input;
  const name = (p.display_name ?? "").trim() || "Builder";

  const l = new Lines();
  l.line(`# Builder — ${name}`);

  l.para("Headline", p.headline);
  l.para("Bio", p.bio);

  const education = [
    p.education_school,
    p.education_major && `— ${p.education_major}`,
    p.education_year && `(${p.education_year})`,
  ]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" ");
  l.para("Education", education);

  l.bullets("Links", [p.linkedin_url, p.github_url, p.portfolio_url]);
  l.bullets("Tags", p.tags);

  l.bullets(
    "Experience",
    experience.map((e) => {
      const period = [e.start_label, e.end_label].map((s) => (s ?? "").trim()).filter(Boolean);
      const when = period.length ? ` (${period.join("–")})` : "";
      const desc = e.description?.trim() ? ` — ${e.description.trim()}` : "";
      return `${e.role} at ${e.company}${when}${desc}`;
    })
  );

  l.bullets(
    "Projects",
    projects.map((pr) => {
      const desc = pr.description?.trim() ? ` — ${pr.description.trim()}` : "";
      const tech = pr.tech?.length ? ` [${pr.tech.join(", ")}]` : "";
      return `${pr.name}${desc}${tech}`;
    })
  );

  l.bullets(
    "Coding tools",
    codingTools.map((t) => `${t.name}${t.category ? ` [${t.category}]` : ""}`)
  );

  return hasBody(l.toString());
}

export interface OperatorProfileInput {
  /** Engagement title or project name — the business this engagement is about. */
  businessName: string;
  /** The operator who runs the engagement day-to-day ("who runs it"). */
  operatorName: string | null;
  prospectName: string | null;
  prospectEmail: string | null;
  websiteUrl: string | null;
  linkedinUrl: string | null;
  /** Freeform project.context notes. */
  context: string | null;
  /** old_workflow / problem narrative cards. */
  businessContext: BusinessContextCard[];
}

export function serializeOperatorProfile(input: OperatorProfileInput): string {
  const name = (input.businessName ?? "").trim() || "Operator";

  const l = new Lines();
  l.line(`# Operator / Business — ${name}`);

  l.para("Run day-to-day by", input.operatorName);

  const contact = [
    (input.prospectName ?? "").trim(),
    input.prospectEmail?.trim() ? `<${input.prospectEmail.trim()}>` : "",
  ]
    .filter(Boolean)
    .join(" ");
  l.para("Primary contact", contact);

  l.para("Website", input.websiteUrl);
  l.para("LinkedIn", input.linkedinUrl);

  const oldWorkflow = input.businessContext.find((c) => c.kind === "old_workflow");
  const problem = input.businessContext.find((c) => c.kind === "problem");
  l.para("How they work today", oldWorkflow?.body);
  l.para("Problem being solved", problem?.body);

  l.para("Notes", input.context);

  return hasBody(l.toString());
}
