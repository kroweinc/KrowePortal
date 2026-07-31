/* Refines a SINGLE section of an existing quote from a freeform builder
   instruction ("add a training module", "more hours on auth"). Mirrors
   refine-prd-section.ts — it sees the rest of the quote for context but the
   response schema only admits the target section's keys. */

import { runChat, AI_MODEL } from "./client";
import type { AiCallMeta } from "./usage";
import { quoteSectionResult } from "./schemas";
import { buildRefineQuoteSectionSystemPrompt } from "./refine-prompts";
import { jsonResponseFormat, stripNullsDeep } from "./strict-schema";
import { providedKeys, scopePatch } from "@/lib/doc/refine";
import type { QuoteContent } from "@/lib/types";

export type RefineQuoteSectionInput = {
  sectionId: string;
  sectionTitle: string;
  /** The QuoteContent keys this section owns — the only keys the model may output. */
  sectionFields: string[];
  /** The full current quote content, including the builder's unsaved inline edits. */
  currentContent: QuoteContent;
  /** What the builder typed. Casual and unstructured by design — often a fragment. */
  instruction: string;
  businessContext?: string;
  currentDate: string;
};

export type RefineQuoteSectionResult = { patch: Partial<QuoteContent> };

/* The document goes in twice-over otherwise: once whole for context, once as the
   focused section. Splitting it keeps the section last (nearest the instruction,
   where it reads as the thing being edited) without paying for the duplicate. */
function buildUserPrompt(input: RefineQuoteSectionInput): string {
  const content = (input.currentContent ?? {}) as Record<string, unknown>;
  const own = new Set(input.sectionFields);
  const context: Record<string, unknown> = {};
  const current: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(content)) if (!own.has(k)) context[k] = v;
  for (const k of input.sectionFields) current[k] = content[k];

  const lines: string[] = [];
  lines.push(`Today's date: ${input.currentDate}.`);
  if (input.businessContext) lines.push(`Business context / source notes:\n${input.businessContext}`);
  lines.push("");
  lines.push("The rest of the quote, for context only:");
  lines.push("```json");
  lines.push(JSON.stringify(context, null, 2));
  lines.push("```");
  lines.push("");
  lines.push(`The section you are refining is "${input.sectionTitle}". Its keys are: ${input.sectionFields.join(", ")}.`);
  lines.push("Current values:");
  lines.push("```json");
  lines.push(JSON.stringify(current, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("## What the builder wants changed");
  lines.push(input.instruction.trim());
  return lines.join("\n");
}

async function callOpenAI(
  systemPrompt: string,
  userPrompt: string,
  responseFormat: ReturnType<typeof jsonResponseFormat>,
  meta?: AiCallMeta
): Promise<{ content: string; truncated: boolean }> {
  const response = await runChat({
    model: AI_MODEL,
    max_completion_tokens: 8000,
    response_format: responseFormat,
    // The system prompt is byte-identical for every quote refine, so a stable key
    // keeps the shared prefix (rules + the document that follows) on one cache
    // node. Quality-neutral — caching never changes output.
    prompt_cache_key: "quote-refine-v1",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  }, meta);
  const choice = response.choices[0];
  return { content: choice?.message?.content ?? "", truncated: choice?.finish_reason === "length" };
}

/** Non-throwing parse of a refine response: returns null on a parse or schema
    failure so the caller can resample once. Keys the model returned as null are
    dropped here — see providedKeys for why that can't wait until after parsing. */
function tryParseRefine(
  raw: string,
  input: RefineQuoteSectionInput,
  schema: ReturnType<typeof quoteSectionResult>
): RefineQuoteSectionResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    return null;
  }

  const provided = providedKeys((parsed as { patch?: unknown })?.patch);
  const result = schema.safeParse(stripNullsDeep(parsed));
  if (!result.success) return null;

  const patch = (result.data as { patch: Record<string, unknown> }).patch;
  return { patch: scopePatch<QuoteContent>(patch, input.sectionFields, provided) };
}

export async function refineQuoteSection(input: RefineQuoteSectionInput, meta?: AiCallMeta): Promise<RefineQuoteSectionResult> {
  const schema = quoteSectionResult(input.sectionId, input.sectionFields);
  const systemPrompt = buildRefineQuoteSectionSystemPrompt();
  const userPrompt = buildUserPrompt(input);
  const responseFormat = jsonResponseFormat(schema, "quote_section_patch");
  const callOnce = () => callOpenAI(systemPrompt, userPrompt, responseFormat, meta);

  // A stray first sample self-corrects; a second failure is real. Don't resample a
  // truncated response — the same prompt regenerates the same over-long output and
  // burns a second full generation to fail identically.
  const first = await callOnce();
  let result = tryParseRefine(first.content, input, schema);
  if (!result && !first.truncated) {
    result = tryParseRefine((await callOnce()).content, input, schema);
  }
  // Degrade to an empty (no-op) patch rather than erroring the builder out — the
  // dialog surfaces that as "no changes proposed".
  return result ?? { patch: {} };
}
