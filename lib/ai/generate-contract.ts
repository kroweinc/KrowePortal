import { runChat, AI_MODEL } from "./client";
import type { AiCallMeta } from "./usage";
import type { ContractContent, QuoteContent, PrdContent } from "@/lib/types";

export type ContractDraftInput = {
  title: string;
  notes: string;
  providerName?: string;
  clientName?: string;
  quoteContent?: QuoteContent;
  /**
   * The project's approved PRD, when one exists. Drives scope of services and
   * deliverables so the contract reflects what was agreed in the PRD.
   */
  prdContent?: PrdContent;
  /**
   * Discovery-call transcript(s) for the project, pre-composed via
   * composeSopBlock. BACKGROUND ONLY — when a PRD/quote is present the contract
   * takes scope/fees from them; the transcript only fills gaps (e.g. a contract
   * drafted before any PRD/quote exists).
   */
  sopContext?: string;
};

type AIResponse = {
  parties?: { provider?: string; client?: string };
  scopeOfServices?: string;
  deliverables?: string[];
  fees?: string;
  paymentTerms?: string;
  timeline?: string;
  ipOwnership?: string;
  confidentiality?: string;
  warranties?: string;
  liability?: string;
  termination?: string;
  changeManagement?: string;
  governingLaw?: string;
  additionalTerms?: string[];
};

const SYSTEM_PROMPT = `You are drafting a plain-English software services agreement (a freelance/agency contract) from a solo software builder's raw notes about a client engagement.

This is an OUTBOUND document the builder will refine and send to the client to e-sign. Write fair, standard, readable terms — the kind a reasonable solo builder serving a small business would use. Plain English over legalese. Do NOT include "this is not legal advice" disclaimers in the body.

Output ONLY valid JSON in this exact shape (omit fields the notes don't support):

{
  "parties": { "provider": "the builder/agency name", "client": "the client business name" },
  "scopeOfServices": "What the provider will do, in 2–6 sentences.",
  "deliverables": [ "A concrete deliverable." ],
  "fees": "The pricing model and amounts (fixed fee, hourly rate, retainer).",
  "paymentTerms": "Payment schedule, deposit, invoicing cadence, late-payment terms.",
  "timeline": "Expected duration / key dates.",
  "ipOwnership": "Who owns the work product and when (e.g. IP transfers to client upon full payment; provider retains pre-existing tools).",
  "confidentiality": "Mutual confidentiality terms.",
  "warranties": "Warranty period and what's covered; disclaimers of implied warranties.",
  "liability": "Limitation of liability (e.g. capped at total fees paid).",
  "termination": "How either party may terminate, notice period, kill-fee / payment for work done.",
  "changeManagement": "How out-of-scope changes are handled (written change orders, re-quoting).",
  "governingLaw": "Governing jurisdiction if mentioned.",
  "additionalTerms": [ "Any other clause the notes call for." ]
}

Sensible DEFAULTS to apply UNLESS the notes contradict them:
- IP assigns to the client upon receipt of full payment; the provider retains rights to pre-existing/general-purpose tools and know-how.
- 30-day warranty on delivered work for defects against the agreed spec.
- Mutual confidentiality.
- Liability capped at the total fees paid under the agreement.
- Either party may terminate with written notice; client pays for work completed to date (kill-fee = work done + any non-refundable deposit).
- Out-of-scope changes require a written change order before work proceeds.

Rules:
- Use the provided provider/client names in "parties" when given.
- If a quote is provided, make "fees", "paymentTerms", and "deliverables" CONSISTENT with it — do not contradict the quoted amounts or scope. The contract attaches the quote's full Payment Schedule and Scope of Work as exhibits, so "fees" should state the total and reference the payment schedule rather than re-listing every milestone, and "paymentTerms" should describe deposit / invoicing / late terms (not restate each milestone amount).
- If a PRD is provided, base "scopeOfServices" and "deliverables" on its features and requirements; keep them consistent with both the PRD and the quote.
- If a "Discovery context" transcript is provided, treat it as BACKGROUND ONLY. When a PRD or quote is present, take scope, deliverables, fees, and payment terms from THEM — never from the raw transcript. Use the transcript only to fill gaps the PRD/quote leave open (e.g. governing jurisdiction, special arrangements the parties discussed). Never quote transcript text verbatim.
- Do NOT invent jurisdiction, dates, or amounts not present in the notes, quote, or PRD. Leave them out / null.`;

function buildUserPrompt(input: ContractDraftInput): string {
  const lines: string[] = [];
  lines.push(`Contract title: ${input.title}`);
  if (input.providerName) lines.push(`Provider (builder): ${input.providerName}`);
  if (input.clientName) lines.push(`Client: ${input.clientName}`);
  lines.push("");
  lines.push("Raw notes:");
  lines.push(input.notes || "(none)");

  const q = input.quoteContent;
  if (q) {
    lines.push("");
    lines.push("Associated quote breakdown (keep fees/scope consistent with this):");
    if (q.scopeSummary) lines.push(`- Scope summary: ${q.scopeSummary}`);
    if (typeof q.totals?.grand === "number") lines.push(`- Quoted total: $${q.totals.grand}`);
    const modules = (q.modules ?? [])
      .map((m) => (m.purpose ? `${m.title} (${m.purpose})` : m.title))
      .filter(Boolean);
    if (modules.length) lines.push(`- Build scope: ${modules.join("; ")}`);
    const milestones = (q.paymentMilestones ?? [])
      .map((m) => `${m.label}: $${m.amount}${m.percent != null ? ` (${m.percent}%)` : ""}`)
      .filter(Boolean);
    if (milestones.length) lines.push(`- Payment schedule: ${milestones.join("; ")}`);
    if (q.scopeProtection?.length) lines.push(`- Out of scope unless separately quoted: ${q.scopeProtection.join("; ")}`);
  }

  const prd = input.prdContent;
  if (prd) {
    lines.push("");
    lines.push("Approved PRD (base scope of services and deliverables on this):");
    if (prd.overview) lines.push(`- Overview: ${prd.overview}`);
    const features = (prd.features ?? []).map((f) => f.title).filter(Boolean);
    if (features.length) lines.push(`- Features: ${features.join("; ")}`);
    if (prd.requirements?.length) lines.push(`- Requirements: ${prd.requirements.join("; ")}`);
  }

  if (input.sopContext?.trim()) {
    lines.push("");
    lines.push(
      "Discovery context (BACKGROUND ONLY — when a PRD or quote is present above, take scope/fees/deliverables from them; use this only to fill gaps they leave open):"
    );
    lines.push(input.sopContext.trim());
  }
  return lines.join("\n");
}

function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim());
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

export async function generateContractDraft(
  input: ContractDraftInput,
  meta?: AiCallMeta
): Promise<ContractContent> {
  let ai: AIResponse = {};

  try {
    const response = await runChat(
      {
        model: AI_MODEL,
        max_completion_tokens: 2400,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(input) },
        ],
      },
      meta
    );

    const raw = response.choices[0]?.message?.content ?? "{}";
    ai = JSON.parse(raw) as AIResponse;
  } catch (err) {
    console.error("[generateContractDraft] AI call failed", err);
    ai = {};
  }

  const provider = str(ai.parties?.provider) ?? input.providerName;
  const client = str(ai.parties?.client) ?? input.clientName;

  return {
    parties: provider || client ? { provider, client } : undefined,
    // Effective date is system-managed (floats to today, freezes on send) — never
    // drafted by the AI, so it isn't set here.
    scopeOfServices: str(ai.scopeOfServices),
    deliverables: strList(ai.deliverables),
    fees: str(ai.fees),
    paymentTerms: str(ai.paymentTerms),
    timeline: str(ai.timeline),
    ipOwnership: str(ai.ipOwnership),
    confidentiality: str(ai.confidentiality),
    warranties: str(ai.warranties),
    liability: str(ai.liability),
    termination: str(ai.termination),
    changeManagement: str(ai.changeManagement),
    governingLaw: str(ai.governingLaw),
    additionalTerms: strList(ai.additionalTerms),
  };
}
