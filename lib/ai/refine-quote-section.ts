/* Refines a SINGLE section of an existing quote. Mirrors generate-quote.ts:
   OpenAI JSON mode + Zod validation with one retry. It sees the full current
   quote for context but may only ask about, and rewrite, the target section's
   keys. The caller whitelists the returned patch to those keys as a second
   guard. */

import { runChat, AI_MODEL } from "./client";
import type { AiCallMeta } from "./usage";
import { RefineQuoteSectionResult as RefineSchema, RefineQuoteSectionFinalResult } from "./schemas";
import type { Question } from "./schemas";
import type { QuoteAnswer } from "./generate-quote";
import type { QuoteContent } from "@/lib/types";

export type RefineQuoteSectionInput = {
  sectionId: string;
  sectionTitle: string;
  /** The QuoteContent keys this section owns — the only keys the model may output. */
  sectionFields: string[];
  /** The full current quote content, including the builder's unsaved inline edits. */
  currentContent: QuoteContent;
  businessContext?: string;
  answers?: QuoteAnswer[];
  /** When true, the model must return a section patch and may NOT ask more questions. */
  forceFinal: boolean;
  currentDate: string;
};

export type RefineQuoteSectionResult =
  | { kind: "questions"; items: Question[] }
  | { kind: "section"; patch: Partial<QuoteContent> };

const QUALITY_RULES = `Write concrete, client-ready content for a non-technical small-business owner — never generic, never one-liners.
- Ground the section in the actual product described by the rest of the quote (provided for context). Do not contradict other sections.
- Pricing is EFFORT-based and AI-ASSISTED: if you touch "modules", give each line item as { label, hours, notes? } where "hours" is a realistic builder-hour estimate assuming AI coding agents one-shot most straightforward UI/CRUD work (a basic form ≈ 0.5–1.5h, NOT a day; a whole standard CRUD module ≈ 2–6h). Reserve larger hours (~2–8h each) for integrations, auth/security, and work that needs real debugging or testing. Do NOT output dollar amounts, subtotals, costs, or totals; the runtime prices each item as hours × the quote's hourly rate. Be honest, don't pad. If you touch "paymentMilestones", return { label, percent } with percents summing to 100; the runtime computes the dollar amounts from the grand total.
- All figures are implementation ESTIMATES, not a binding contract.
- Do NOT fabricate client-specific facts (a real signed budget, a real deadline).`;

function buildSystemPrompt(input: RefineQuoteSectionInput): string {
  const base = `You are REFINING a single section of an existing OUTBOUND product QUOTE (a client-facing price breakdown). The builder is sharpening one section; you must improve ONLY that section and leave the rest of the quote untouched.

The section being refined is: "${input.sectionTitle}".
You may ONLY output these JSON keys (they belong to this section): ${input.sectionFields.join(", ")}.
Do NOT output any other keys. Use the rest of the quote (provided below) as context only.

${QUALITY_RULES}

Output ONLY valid JSON.`;

  if (input.forceFinal) {
    return `${base}

Return the refined section now, as JSON:
{ "kind": "section", "patch": { ...only the allowed keys, fully filled... } }
Do NOT ask any more questions. For anything still unknown, make a sensible, clearly-stated estimate rather than leaving the section thin.`;
  }

  return `${base}

If a focused clarifying answer would materially improve this section, ask first. Return 1–3 concrete multiple-choice questions (each offers 3–5 options ranked most→least likely; the builder can also type their own), all targeted at THIS section:
{ "kind": "questions", "items": [ { "id": "q1", "text": "…", "options": ["…","…","…"], "multiSelect": false, "recommended": "…", "recommendation": "Best for you because …" } ] }
Set "multiSelect": true when more than one option could legitimately apply; otherwise false. Always include the multiSelect field.
For EACH question, mark exactly ONE option as recommended: set "recommended" to that option's exact text (character-for-character one of the "options" strings) and "recommendation" to one short, plain-language sentence on why it's the best default. Omit both only if no option is meaningfully better.
Otherwise, if you already have enough to improve the section well, return the refined section directly:
{ "kind": "section", "patch": { ...only the allowed keys... } }`;
}

function buildUserPrompt(input: RefineQuoteSectionInput): string {
  const lines: string[] = [];
  lines.push(`Today's date: ${input.currentDate}.`);
  if (input.businessContext) lines.push(`Business context / source notes:\n${input.businessContext}`);
  lines.push("");
  lines.push("The FULL current quote content (context — do not change keys outside the target section):");
  lines.push("```json");
  lines.push(JSON.stringify(input.currentContent ?? {}, null, 2));
  lines.push("```");
  lines.push("");

  const current: Record<string, unknown> = {};
  for (const k of input.sectionFields) {
    current[k] = (input.currentContent as Record<string, unknown>)?.[k];
  }
  lines.push(`Current values of the "${input.sectionTitle}" section you are refining:`);
  lines.push("```json");
  lines.push(JSON.stringify(current, null, 2));
  lines.push("```");

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

async function callOpenAI(systemPrompt: string, userPrompt: string, maxTokens: number, meta?: AiCallMeta): Promise<string> {
  const response = await runChat({
    model: AI_MODEL,
    max_completion_tokens: maxTokens,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  }, meta);
  return response.choices[0]?.message?.content ?? "";
}

/** Keep only the keys this section owns — a hard guard so a refine can never
    clobber another section, regardless of what the model returns. */
function whitelist(patch: Record<string, unknown>, fields: string[]): Partial<QuoteContent> {
  const out: Record<string, unknown> = {};
  for (const k of fields) if (k in patch) out[k] = patch[k];
  return out as Partial<QuoteContent>;
}

export async function refineQuoteSection(input: RefineQuoteSectionInput, meta?: AiCallMeta): Promise<RefineQuoteSectionResult> {
  const schema = input.forceFinal ? RefineQuoteSectionFinalResult : RefineSchema;
  const systemPrompt = buildSystemPrompt(input);
  const userPrompt = buildUserPrompt(input);
  const maxTokens = 8000;

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
    if (input.forceFinal) return { kind: "section", patch: {} };
    throw new Error("AI response validation failed");
  }

  const data = result.data;
  if (data.kind === "questions") {
    return { kind: "questions", items: data.items };
  }
  return {
    kind: "section",
    patch: whitelist(data.patch as Record<string, unknown>, input.sectionFields),
  };
}
