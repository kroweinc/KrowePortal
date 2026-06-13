import { runChat, AI_MODEL } from "./client";
import type { AiCallMeta } from "./usage";
import { QuoteGenerationResult, QuoteFinalResult } from "./schemas";
import type { Question } from "./schemas";
import { DEFAULT_QUOTE_HOURLY_RATE } from "@/lib/quote/totals";
import type { QuoteContent, PrdContent } from "@/lib/types";

export type QuoteAnswer = { question: string; answer: string };

export type QuoteGenInput = {
  title: string;
  /** From-notes / discovery path: raw pasted notes. */
  notes?: string;
  /** From-PRD path: the PRD content to price. Serialized into the prompt. */
  prdContent?: PrdContent;
  businessContext?: string;
  answers?: QuoteAnswer[];
  /** When true, the model must return a finished quote and may NOT ask more questions. */
  forceFinal: boolean;
  /** No PRD and no notes — interview broad→specific over more rounds and emit a contextSummary. */
  deepContext?: boolean;
  /** Today's date as an ISO calendar date (YYYY-MM-DD). */
  currentDate: string;
};

export type QuoteGenResult =
  | { kind: "questions"; items: Question[] }
  | { kind: "quote"; content: QuoteContent; contextSummary?: string };

const SECTIONS = `The quote uses these JSON keys. Write a polished, client-ready PRICING breakdown a non-technical small-business owner can read top to bottom and understand exactly what they're paying for. A shallow, vague quote is a FAILURE — be specific and concrete, grounded in the actual product.

1. companyName (string) — the client's company/business name (header).
2. clientName (string, optional) — the individual the quote is prepared for, if known.
3. productSubtitle (string) — a short product line under the company name (e.g. "AI Business Productivity + AI Calls MVP").
4. scopeSummary (string) — one paragraph (2–4 sentences) summarizing what this quote covers at a high level: the modules included and that it also covers design, deployment, testing, launch support, and handoff. Lead with the total project price in words if helpful.
5. modules (array of { title, purpose, description, lineItems[] }) — the heart of the quote. Break the product into 1–6 connected PRODUCT AREAS / modules (e.g. "Business OS", "AI Phone Assistant", "Social Media Content Generator"). For EACH module:
   - "title" = the module name.
   - "purpose" = one concise line describing what it does (the §1 product-table "Purpose" column).
   - "description" = a 1–3 sentence paragraph expanding on the module (the per-module section intro).
   - "lineItems" = the granular work items inside that module, each { label, hours, notes? } where "hours" is the realistic builder-hour estimate for that item ASSUMING the builder uses AI coding agents that one-shot most straightforward work (e.g. a basic "Customer intake form with validation" an agent generates in one pass → 1, not 8). Aim for 3–8 line items per module. Do NOT output dollar amounts — the runtime prices every item as hours × the hourly rate. The cost/subtotal/totals are computed for you, so you may omit them.
6. designSystem (array of { component, included }) — the "Design System Included" checklist: UI/UX deliverables bundled into the product pricing (e.g. "Dashboard layout and navigation", "Reusable buttons, inputs, cards, tables", "Responsive layout for desktop and mobile", "Consistent spacing, typography, and UI polish"). Set "included": true for what's covered. 5–8 rows.
7. paymentMilestones (array of { label, percent }) — the "Suggested Payment Structure": how the total is split into payments (e.g. "50% upfront to begin development" → percent 50; "25% after core features work" → percent 25; "25% before final launch and handoff" → percent 25). Provide the PERCENTS only (they must sum to 100); the runtime computes each milestone's dollar amount from the grand total.
8. justification (string[]) — the "Why This Price Is Justified" bullets: 3–6 plain-language reasons the price is fair (real integration complexity, multiple connected tools, security/auth work, design system, that the price includes testing/deployment/revisions/handoff — not just raw coding).
9. scopeProtection (string[]) — the "Not included unless separately quoted" list: features explicitly OUT of scope for this price (e.g. "CRM write-back", "SMS workflows", "public website chatbot", "multi-user accounts", "payment processing", "mobile app"). Be generous and explicit — protects you from scope creep and builds trust.
10. totals (object { grand, modulesTotal, paymentTotal }) — COMPUTED by the runtime from the line-item hours × rate; you may omit it entirely.
11. validityDays (number, optional) — how many days the quote stays valid (e.g. 30).
12. footerNote (string) — a short closing note, e.g. "Prepared from the product PRD. Pricing is an implementation estimate and may change if scope, integrations, or compliance requirements expand."`;

const PRICING_RULES = `Pricing rules (CRITICAL — price by EFFORT, assuming an AI-assisted builder):
- The builder works WITH AI coding agents. Straightforward UI, forms, pages, CRUD, and standard dashboards are largely ONE-SHOT — an agent generates most of it in a single prompt and the builder's real time is review, wiring, and a quick test, NOT hand-coding from scratch. Estimate the builder's actual hours under that reality. Traditional hand-coding estimates (a form = a day) are WRONG here.
- Price every line item by its realistic builder-HOURS (one builder + agents). The runtime multiplies your hours by $${DEFAULT_QUOTE_HOURLY_RATE}/hr. Output "hours" only; do NOT output dollar amounts, subtotals, costs, or totals — those are computed for you.
- Calibration (AI-assisted, the anchors that matter):
  • A basic form, page, CRUD screen, or simple UI an agent one-shots: ~0.5–1.5 hours — NOT half a day. When several such items live in one module they're often built in one agent pass, so size them as that small COMBINED effort; don't price each as if hand-built from scratch.
  • A whole module of standard CRUD/dashboard work: ~2–6 hours total.
  • Work agents CANNOT reliably one-shot — third-party integrations (phone/AI calls, payments, external APIs), auth/security, non-trivial data modeling, and anything needing real debugging, credentials, or careful testing: ~2–8 hours each. This is where the genuine hours live; weight the estimate here, not on the easy UI.
- Calibrate the WHOLE project by scope: a simple one- or two-module tool is typically ~6–20 total hours; a medium multi-module product ~20–60 hours; only a genuinely large, integration-heavy build exceeds 60 hours. Be HONEST and do NOT pad to hit a target total. Round hours to whole or half hours.
- The breakdown ties out automatically: each module.cost = Σ its line-item amounts, totals.grand = Σ module.cost, and the payment milestones derive from the grand total via their percents — so just give honest hours and clean percents.
- All figures are implementation estimates — never present them as a binding contract. The footerNote should say so.`;

const QUALITY_RULES = `Depth and honesty:
- Ground every module, line item, and justification in the ACTUAL product (the PRD or notes provided). Never invent features the product doesn't have.
- You MAY include realistic illustrative line items typical for the product's modules, but keep them plausible for THIS product.
- Do NOT fabricate client-specific facts (a real signed budget, a real deadline). The quote is an estimate the builder sends to align on price.
- Write for a non-technical owner: plain language, no jargon in the purpose/description/justification text.`;

function buildSystemPrompt(forceFinal: boolean, deepContext = false): string {
  const deepBlock = deepContext
    ? `

No-context mode (the builder provided NO PRD and NO written notes):
- Sequence your questions foundational → specific. On the FIRST round (no answers yet) ask ONLY broad foundational questions — what the business does, the core product being quoted, which modules/areas it includes, the rough scope/scale, and any budget signal. Do NOT open with per-line-item price questions. As answers accumulate, drill into the per-module specifics needed to price the work.
- Whenever you return the finished quote (kind:"quote"), ALSO include a top-level "contextSummary": a concise 1–2 paragraph business-context narrative synthesized from the answers, written so it can be saved and reused as the starting context for future documents about this client.`
    : "";

  const base = `You are drafting an OUTBOUND product QUOTE — a client-facing PRICE breakdown for a software product a builder is pitching. The builder reviews and edits the numbers, then sends it to the prospect to align on price. There is no existing codebase; this is an implementation estimate.

Voice: clear, concrete, non-technical. A small-business owner should understand exactly what they're paying for and why.

${SECTIONS}

${PRICING_RULES}

${QUALITY_RULES}

Output ONLY valid JSON.`;

  if (forceFinal) {
    return `${base}

You have reached the question limit. Return a finished quote now:
{ "kind": "quote", "content": { ...the full quote object... } }
Fill every section with concrete, product-specific content and honest per-line-item HOURS (no dollar amounts — the runtime prices them). Do NOT ask any more questions. Give payment milestones as percents summing to 100.`;
  }

  return `${base}

Your goal is to gather just enough to price the work confidently, then return the quote.
- If a load-bearing pricing detail is missing (which modules are in scope, the rough budget tier, whether integration-heavy features like AI calls/payments are included, the target timeline), ask. Return 2–5 concrete multiple-choice questions per round (each offers 3–5 options, ranked most→least likely; the builder can also type their own):
  { "kind": "questions", "items": [ { "id": "q1", "text": "…", "options": ["…","…","…"], "multiSelect": false, "recommended": "…", "recommendation": "Best for you because …" } ] }
- For EACH question, set "multiSelect": true when more than one option could legitimately apply (e.g. which modules to include, which integrations are needed); false for single-answer questions (e.g. the budget tier, the single payment structure). Always include the multiSelect field.
- For EACH question, mark exactly ONE option as recommended: set "recommended" to that option's exact text (character-for-character one of the "options" strings) and "recommendation" to one short, plain-language sentence on why it's the best default for THIS quote. Omit both only if no option is meaningfully better.
- Once you can price every module from the PRD/notes/answers, return the finished quote:
  { "kind": "quote", "content": { ...the full quote object... } }
Prefer returning the quote quickly when a PRD was provided — it already describes the product; your job is mainly to PRICE it. Only ask questions when the budget tier or module scope is genuinely ambiguous.`;
}

function buildUserPrompt(input: QuoteGenInput): string {
  const lines: string[] = [];
  lines.push(`Quote title: ${input.title}`);
  lines.push(`Today's date: ${input.currentDate}.`);
  if (input.businessContext) lines.push(`Business context: ${input.businessContext}`);
  lines.push("");

  if (input.prdContent && Object.keys(input.prdContent).length > 0) {
    lines.push("Source PRD to price (build the quote's modules and line items from this product):");
    lines.push("```json");
    lines.push(JSON.stringify(input.prdContent, null, 2));
    lines.push("```");
  } else {
    lines.push("Builder notes:");
    lines.push(input.notes && input.notes.trim().length > 0 ? input.notes.trim() : "(none provided)");
  }

  if (input.answers && input.answers.length > 0) {
    lines.push("");
    lines.push("Answers to your clarifying questions so far:");
    for (const a of input.answers) {
      lines.push(`Q: ${a.question}`);
      lines.push(`A: ${a.answer}`);
    }
  }
  return lines.join("\n");
}

async function callOpenAI(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  meta?: AiCallMeta
): Promise<string> {
  const response = await runChat(
    {
      model: AI_MODEL,
      max_completion_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    },
    meta
  );
  return response.choices[0]?.message?.content ?? "";
}

export async function generateQuote(input: QuoteGenInput, meta?: AiCallMeta): Promise<QuoteGenResult> {
  const schema = input.forceFinal ? QuoteFinalResult : QuoteGenerationResult;
  const systemPrompt = buildSystemPrompt(input.forceFinal, input.deepContext);
  const userPrompt = buildUserPrompt(input);
  const maxTokens = 16000;

  let raw = await callOpenAI(systemPrompt, userPrompt, maxTokens, meta);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    parsed = {};
  }

  let result = schema.safeParse(parsed);
  if (!result.success) {
    const errorDesc = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    raw = await callOpenAI(
      systemPrompt,
      `${userPrompt}\n\nYour previous response did not match the required JSON schema. Errors: ${errorDesc}\nReturn corrected JSON only.`,
      maxTokens,
      meta
    );
    try {
      parsed = JSON.parse(raw || "{}");
    } catch {
      parsed = {};
    }
    result = schema.safeParse(parsed);
  }

  if (!result.success) {
    // Last-resort: never throw on the question path — fall through to an empty
    // quote so the wizard can still hand the builder an editable draft.
    if (input.forceFinal) return { kind: "quote", content: {} };
    throw new Error("AI response validation failed");
  }

  const data = result.data;
  if (data.kind === "questions") {
    return { kind: "questions", items: data.items };
  }
  const content: QuoteContent = {
    ...(data.content as QuoteContent),
    hourlyRate: (data.content as QuoteContent).hourlyRate ?? DEFAULT_QUOTE_HOURLY_RATE,
  };
  return { kind: "quote", content, contextSummary: data.contextSummary };
}
