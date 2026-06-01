/* Refines a SINGLE section of an existing PRD. Mirrors generate-prd.ts: OpenAI
   JSON mode + Zod validation with one retry. Unlike generatePrd (which drafts the
   whole document), this is scoped — it sees the full current PRD for context but
   may only ask about, and rewrite, the target section's keys. The caller
   whitelists the returned patch to those keys as a second guard. */

import { openai, AI_MODEL } from "./client";
import { RefineSectionResult as RefineSchema, RefineSectionFinalResult } from "./schemas";
import type { Question } from "./schemas";
import type { PrdAnswer } from "./generate-prd";
import type { PrdContent } from "@/lib/types";

export type RefineSectionInput = {
  sectionId: string;
  sectionTitle: string;
  /** The PrdContent keys this section owns — the only keys the model may output. */
  sectionFields: string[];
  /** The full current PRD content, including the builder's unsaved inline edits. */
  currentContent: PrdContent;
  businessContext?: string;
  answers?: PrdAnswer[];
  /** When true, the model must return a section patch and may NOT ask more questions. */
  forceFinal: boolean;
  currentDate: string;
};

export type RefineSectionResult =
  | { kind: "questions"; items: Question[] }
  | { kind: "section"; patch: Partial<PrdContent> };

const QUALITY_RULES = `Write RICH, CONCRETE content for a small-business owner who must recognize THEIR product — never generic, never one-liners. Aim for the depth of a polished, client-ready document.
- You ARE encouraged to include ILLUSTRATIVE examples (sample options, field lists, sample ID formats), clearly framed as examples — never as committed facts.
- Do NOT fabricate CLIENT-SPECIFIC facts (real vendors, negotiated prices, a real deadline, a chosen tool the builder hasn't agreed to). For any cost you supply from general knowledge, set "estimated": true on that item.
- Never include a project price or payment terms anywhere in the PRD — those live in the separate quote.
- Keep the section consistent with the rest of the PRD (the full document is provided for context). Do not contradict other sections.`;

function buildSystemPrompt(input: RefineSectionInput): string {
  const base = `You are REFINING a single section of an existing OUTBOUND Product Requirements Document (PRD). The builder is sharpening one under-specified section; you must improve ONLY that section and leave the rest of the document untouched.

The section being refined is: "${input.sectionTitle}".
You may ONLY output these JSON keys (they belong to this section): ${input.sectionFields.join(", ")}.
Do NOT output any other keys. Use the rest of the PRD (provided below) as context only.

${QUALITY_RULES}

Output ONLY valid JSON.`;

  if (input.forceFinal) {
    return `${base}

Return the refined section now, as JSON:
{ "kind": "section", "patch": { ...only the allowed keys, fully filled... } }
Do NOT ask any more questions. For anything still unknown, make a sensible, clearly-stated assumption rather than leaving the section thin.`;
  }

  return `${base}

If a focused clarifying answer would materially improve this section, ask first. Return 1–3 concrete multiple-choice questions (each offers 3–5 options ranked most→least likely; the builder can also type their own), all targeted at THIS section:
{ "kind": "questions", "items": [ { "id": "q1", "text": "…", "options": ["…","…","…"], "multiSelect": false, "recommended": "…", "recommendation": "Best for you because …" } ] }
Set "multiSelect": true when more than one option could legitimately apply; otherwise false. Always include the multiSelect field.
For EACH question, mark exactly ONE option as recommended: set "recommended" to that option's exact text (character-for-character one of the "options" strings) and "recommendation" to one short, plain-language sentence on why it's the best default for THIS product. For technical questions, reason about the best real-world method first. For multi-select, recommend the single option most worth including. Omit both only if no option is meaningfully better.
Otherwise, if you already have enough to improve the section well, return the refined section directly:
{ "kind": "section", "patch": { ...only the allowed keys... } }`;
}

function buildUserPrompt(input: RefineSectionInput): string {
  const lines: string[] = [];
  lines.push(`Today's date: ${input.currentDate}.`);
  if (input.businessContext) lines.push(`Business context / source notes:\n${input.businessContext}`);
  lines.push("");
  lines.push("The FULL current PRD content (context — do not change keys outside the target section):");
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

async function callOpenAI(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<string> {
  const response = await openai.chat.completions.create({
    model: AI_MODEL,
    max_completion_tokens: maxTokens,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  return response.choices[0]?.message?.content ?? "";
}

/** Keep only the keys this section owns — a hard guard so a refine can never
    clobber another section, regardless of what the model returns. */
function whitelist(patch: Record<string, unknown>, fields: string[]): Partial<PrdContent> {
  const out: Record<string, unknown> = {};
  for (const k of fields) if (k in patch) out[k] = patch[k];
  return out as Partial<PrdContent>;
}

export async function refinePrdSection(input: RefineSectionInput): Promise<RefineSectionResult> {
  const schema = input.forceFinal ? RefineSectionFinalResult : RefineSchema;
  const systemPrompt = buildSystemPrompt(input);
  const userPrompt = buildUserPrompt(input);
  const maxTokens = 8000;

  let raw = await callOpenAI(systemPrompt, userPrompt, maxTokens);

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
      maxTokens
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
