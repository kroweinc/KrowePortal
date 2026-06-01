import { openai, AI_MODEL } from "./client";
import type { BriefContent, BriefLineItem, PrdContent } from "@/lib/types";

const DEFAULT_HOURLY_RATE = 175;

export type BriefIntake = {
  clientName?: string;
  problem?: string;
  whyNow?: string;
  desiredOutcome?: string;
  audience?: string;
  capabilities?: string;
  integrations?: string;
  timeline?: string;
  outOfScope?: string;
  notes?: string;
};

export type BriefDraftInput = {
  title: string;
  intake: BriefIntake;
  /**
   * The project's approved PRD, when one exists. The quote's scope and line
   * items should cover what the PRD promises so the two documents agree.
   */
  prdContent?: PrdContent;
};

type AILineItem = {
  label: string;
  hours: number;
  notes?: string | null;
};

type AIResponse = {
  summary?: string;
  proposedSolution?: string;
  deliverables?: { title: string; acceptanceCriteria?: string }[];
  preWork?: AILineItem[];
  projectLineItems?: AILineItem[];
  outOfScope?: string[];
  assumptions?: string[];
  timeline?: string;
};

const SYSTEM_PROMPT = `You are drafting a project brief — a combined proposal and statement-of-work — that a software builder will send to a small-business owner (the operator/client) for acceptance BEFORE any build work begins.

This is the FIRST artifact of the engagement. There are no existing tasks, no codebase, no repo, no design system. You are generating the entire proposed scope and pricing from the discovery answers alone.

Voice: pragmatic, direct, no flattery, no marketing fluff. Use the client's own words where possible. Each section should be tight. Match the way an experienced agency owner would write a quote — confident but not pushy, specific but not over-engineered.

Output ONLY valid JSON in this exact shape (omit fields if the intake doesn't support them; empty arrays are acceptable):

{
  "summary": "1–3 sentences: what's the problem and what are we proposing to do about it.",
  "proposedSolution": "2–6 sentences describing the approach at a non-technical level. No tech jargon unless absolutely necessary.",
  "deliverables": [
    { "title": "Specific deliverable name", "acceptanceCriteria": "A testable behavior the operator can verify, e.g. 'Operator can export the filtered customer list as a CSV with one click.'" }
  ],
  "preWork": [
    { "label": "Discovery sprint", "hours": 8, "notes": "Optional short note explaining what this covers." }
  ],
  "projectLineItems": [
    { "label": "Customer-facing form + validation", "hours": 16, "notes": "Optional note." }
  ],
  "outOfScope": [ "Specific thing NOT included, written as a concrete statement." ],
  "assumptions": [ "Something the proposal depends on being true. Usually about client-side responsibilities or environmental constraints." ],
  "timeline": "Short paragraph or bullet list of milestones with rough durations."
}

Rules for the line items:
- preWork covers ONE-TIME work before the build begins. ALWAYS include relevant onboarding items based on the project type. Common ones: Discovery sprint (deeper scoping), Kickoff & credentials gathering, Repo + hosting + database setup, Domain & DNS, Design system / wireframes, Stakeholder interviews. Pick the 2–5 that actually apply to this project.
- projectLineItems covers the BUILD itself. Each deliverable from your "deliverables" section should typically map to one or more line items here. Group small adjacent work; split very large work.
- Provide \`hours\` as a realistic developer-hour estimate (one builder, not a team). Be honest — round to half-hour increments. Do NOT include amounts or dollar figures; the runtime computes those from hours × hourly rate.
- If the intake suggests this is a small project, total hours might be 30–60. Medium: 60–150. Large: 150+. Don't pad.

Rules for the rest:
- Acceptance criteria must be testable behaviors ("user can do X"), not abstractions ("system will be robust").
- Out-of-scope should explicitly list: hosting fees / third-party SaaS subscriptions (always), content creation/migration unless the intake says otherwise, post-launch support beyond 30 days, native mobile apps (unless asked), plus anything the intake's "Things to explicitly leave out" field calls out.
- Assumptions should include: client provides necessary credentials and access within a stated window; client decision turnaround time (e.g. 2 business days on review requests); any third-party systems the client must own/pay for; content/copy ownership.
- If intake is sparse, write LESS rather than padding. Don't invent specifics that weren't implied by the answers.
- If an approved PRD is provided, treat its features and requirements as the source of truth for scope: every "must" feature should be reflected in your line items, and your deliverables should not contradict the PRD. The PRD describes WHAT to build; you are pricing HOW MUCH it costs.`;

function buildUserPrompt(input: BriefDraftInput): string {
  const i = input.intake;
  const lines: string[] = [];
  lines.push(`Brief title: ${input.title}`);
  if (i.clientName) lines.push(`Client / company: ${i.clientName}`);
  lines.push("");
  lines.push(`Discovery answers:`);
  lines.push(`- Problem: ${i.problem || "(not provided)"}`);
  lines.push(`- Why now / current workaround: ${i.whyNow || "(not provided)"}`);
  lines.push(`- Desired outcome (what success looks like): ${i.desiredOutcome || "(not provided)"}`);
  lines.push(`- Audience / who uses it: ${i.audience || "(not provided)"}`);
  lines.push(`- Key capabilities they need: ${i.capabilities || "(not provided)"}`);
  lines.push(`- Integrations / existing systems: ${i.integrations || "(none mentioned)"}`);
  lines.push(`- Timeline target: ${i.timeline || "(not provided)"}`);
  lines.push(`- Things to explicitly leave out: ${i.outOfScope || "(none)"}`);
  lines.push(`- Other notes: ${i.notes || "(none)"}`);

  const prd = input.prdContent;
  if (prd) {
    lines.push("");
    lines.push("Approved PRD for this project (price the scope to cover this — every 'must' feature must be reflected in the line items):");
    if (prd.overview) lines.push(`- Overview: ${prd.overview}`);
    if (prd.targetUsers) lines.push(`- Target users: ${prd.targetUsers}`);
    const features = (prd.features ?? [])
      .map((f) => (f.priority ? `${f.title} (${f.priority})` : f.title))
      .filter(Boolean);
    if (features.length) lines.push(`- Features: ${features.join("; ")}`);
    if (prd.requirements?.length) lines.push(`- Requirements: ${prd.requirements.join("; ")}`);
    if (prd.constraints?.length) lines.push(`- Constraints: ${prd.constraints.join("; ")}`);
  }
  return lines.join("\n");
}

function sanitizeLineItems(items: AILineItem[] | undefined, rate: number): BriefLineItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((it) => it && typeof it.label === "string" && it.label.trim().length > 0)
    .map((it) => {
      const hours = typeof it.hours === "number" && it.hours >= 0 ? it.hours : 0;
      return {
        label: it.label.trim(),
        hours: hours || null,
        amount: Math.round(hours * rate),
        notes: typeof it.notes === "string" && it.notes.trim().length > 0 ? it.notes.trim() : null,
      };
    });
}

export async function generateBriefDraft(input: BriefDraftInput): Promise<BriefContent> {
  let ai: AIResponse = {};

  try {
    const response = await openai.chat.completions.create({
      model: AI_MODEL,
      max_completion_tokens: 2400,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(input) },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    ai = JSON.parse(raw) as AIResponse;
  } catch (err) {
    console.error("[generateBriefDraft] AI call failed", err);
    ai = {};
  }

  const hourlyRate = DEFAULT_HOURLY_RATE;
  const preWork = sanitizeLineItems(ai.preWork, hourlyRate);
  const projectLineItems = sanitizeLineItems(ai.projectLineItems, hourlyRate);

  const preWorkTotal = preWork.reduce((s, li) => s + li.amount, 0);
  const projectTotal = projectLineItems.reduce((s, li) => s + li.amount, 0);
  const grandTotal = preWorkTotal + projectTotal;

  const paymentTerms =
    grandTotal >= 10000
      ? "30% upfront / 40% at midpoint / 30% on acceptance"
      : "50% deposit on acceptance, 50% on final delivery";

  return {
    summary: ai.summary,
    proposedSolution: ai.proposedSolution,
    deliverables: Array.isArray(ai.deliverables)
      ? ai.deliverables
          .filter((d) => d && typeof d.title === "string" && d.title.trim().length > 0)
          .map((d) => ({
            title: d.title.trim(),
            acceptanceCriteria:
              typeof d.acceptanceCriteria === "string" && d.acceptanceCriteria.trim().length > 0
                ? d.acceptanceCriteria.trim()
                : null,
          }))
      : [],
    preWork,
    projectLineItems,
    outOfScope: Array.isArray(ai.outOfScope)
      ? ai.outOfScope.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      : [],
    assumptions: Array.isArray(ai.assumptions)
      ? ai.assumptions.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      : [],
    timeline: ai.timeline,
    paymentTerms,
    hourlyRate,
    validityDays: 30,
    totals: {
      preWork: preWorkTotal,
      project: projectTotal,
      grand: grandTotal,
    },
  };
}
