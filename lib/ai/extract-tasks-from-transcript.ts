import "server-only";

import type OpenAI from "openai";
import { runChat, AI_MODEL } from "./client";
import type { AiCallMeta } from "./usage";
import {
  ExtractedTaskDraft,
  extractedTaskDraft,
  extractTasksResult,
  modelExtractTasksResult,
  type ExtractTasksResult,
} from "./schemas";
import { FALLBACK_AREA_VOCABULARY, type AreaVocabulary } from "@/lib/types";
import { jsonResponseFormat, stripNullsDeep } from "./strict-schema";
import {
  postProcessExtraction,
  reconstructAllSourceText,
  type ExtractionRepair,
} from "./extract-tasks-postprocess";
import {
  buildExtractTasksSystemPrompt,
  buildExtractTasksUserPrompt,
  MAX_TRANSCRIPT_CHARS,
  type ExtractTasksInput,
} from "./prompts";

// Re-exported so callers (the SSE route, granola-import) keep importing the
// input type from the generator they already depend on.
export type { ExtractTasksInput };

// The budget is shared between the reasoning pass and the output JSON: low
// effort typically burns ~1-3k reasoning tokens, and 40 drafts with trimmed
// descriptions + checklists (no sourceText — reconstructed server-side) is
// ~14k — 16k leaves headroom for both.
const MAX_TOKENS = 16_000;

/** The allowed area slugs for one extraction, as the schema factories want them.
 *  Falls back to the generic taxonomy so an input built before the vocabulary
 *  seam existed still decodes. */
function areaSlugs(input: ExtractTasksInput): string[] {
  return (input.areas ?? FALLBACK_AREA_VOCABULARY).values.map((a) => a.slug);
}

/** A short, stable id for one vocabulary — enough to separate cache lanes
 *  without putting a repo's whole area list in a request field. Same slug list
 *  in the same order always yields the same tag. */
function areaCacheTag(input: ExtractTasksInput): string {
  const joined = areaSlugs(input).join(",");
  let hash = 0;
  for (let i = 0; i < joined.length; i++) hash = (Math.imul(31, hash) + joined.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

/**
 * The exact request params for a task extraction — shared by the blocking call
 * below and the SSE streaming route (app/api/ai/granola/extract-tasks/stream),
 * so the two paths can never drift on model, prompt, effort, or schema.
 */
export function buildExtractionParams(input: ExtractTasksInput) {
  // A truncated transcript is a real recall hole the post-processor cannot see:
  // buildExtractTasksUserPrompt drops the MIDDLE of an over-long call, so a
  // commitment made mid-call and never recapped is absent from the model's input
  // entirely. Log it so we know whether that's theoretical or routine before
  // blaming the prompt for a missed task.
  if (input.transcript.length > MAX_TRANSCRIPT_CHARS) {
    console.warn(
      `[extract-tasks] transcript truncated: ${input.transcript.length} chars, ` +
        `${input.transcript.length - MAX_TRANSCRIPT_CHARS} dropped from the middle. ` +
        "Commitments made mid-call and never recapped are not in the model's input."
    );
  }
  return {
    model: AI_MODEL,
    max_completion_tokens: MAX_TOKENS,
    // Inherits the app-wide reasoning effort (OPENAI_REASONING_EFFORT, default
    // "low") via runChat/runChatStream — the deterministic post-process safety
    // net (completeness, misattribution repair) backstops the recall a deeper
    // pass would buy, at a fraction of the latency.
    // Steer OpenAI's automatic prompt cache: EXTRACT_TASKS_SYSTEM_BASE (the ~40-line
    // instruction block in lib/ai/prompts.ts) is a large static prefix re-sent on
    // every extraction, so a stable key raises the cache-hit rate on that prefix —
    // cutting TTFT with zero quality change (caching never alters output). Shared by
    // the blocking and streaming paths since both build params here. Bumped to v2
    // when the instruction block was rewritten, and to v3 when the area
    // vocabulary moved out of the base into an appended per-repo block.
    //
    // Suffixed with the vocabulary's identity, because the strict json_schema in
    // response_format carries this repo's tags enum and sits AHEAD of the system
    // message in the cached prefix. One shared key across repos would route
    // requests with differing prefixes into the same cache lane and miss every
    // time; a per-vocabulary key gives each repo its own lane, which is where
    // the reuse actually is — a builder importing several calls for one client.
    prompt_cache_key: `granola-task-extraction-v3-${areaCacheTag(input)}`,
    response_format: jsonResponseFormat(
      modelExtractTasksResult(areaSlugs(input)),
      "granola_task_extraction"
    ),
    messages: [
      {
        role: "system",
        content: buildExtractTasksSystemPrompt(
          input.builderName ?? null,
          input.areas ?? FALLBACK_AREA_VOCABULARY
        ),
      },
      { role: "user", content: buildExtractTasksUserPrompt(input) },
    ],
  } satisfies OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
}

/** Strict validation of a complete model response. Returns ALL owners' tasks —
    assignee filtering happens after extraction (filterDraftsByOwner /
    isBuilderOwnedDraft), never during parsing. */
export function parseExtractionResult(content: string, slugs: string[]): ExtractTasksResult {
  const parsed = extractTasksResult(slugs).safeParse(stripNullsDeep(JSON.parse(content)));
  if (!parsed.success) {
    throw new Error(`Task extraction returned malformed JSON: ${parsed.error.message}`);
  }
  return parsed.data;
}

/** Safer fallback parser: salvage every individually valid item from a
    response whose envelope failed strict validation, instead of dropping the
    whole batch. Throws only when nothing at all is recoverable. */
export function parseExtractionResultLenient(
  content: string,
  slugs: string[]
): ExtractTasksResult {
  const raw = stripNullsDeep(JSON.parse(content)) as { items?: unknown };
  if (!Array.isArray(raw?.items)) throw new Error("Task extraction response has no items array.");
  const draft = extractedTaskDraft(slugs);
  const items: ExtractedTaskDraft[] = [];
  for (const candidate of raw.items.slice(0, 40)) {
    const parsed = draft.safeParse(candidate);
    if (parsed.success) items.push(parsed.data as ExtractedTaskDraft);
  }
  if (items.length === 0) throw new Error("Task extraction returned no valid items.");
  return { items };
}

function logRepairs(repairs: ExtractionRepair[], meta?: AiCallMeta) {
  for (const repair of repairs) {
    console.warn(
      `[extract-tasks] ${repair.kind}: ${repair.detail}`,
      meta?.operation ? `(op=${meta.operation})` : "",
      repair.sourceText ? `source=${JSON.stringify(repair.sourceText.slice(0, 200))}` : ""
    );
  }
}

/**
 * Parse a complete model response, reconstruct each draft's sourceText from
 * its sourceQuote (the model no longer emits sourceText — see
 * ModelExtractedTaskDraft), and run the deterministic safety net
 * (owner normalization, misattribution repair, dedup, completeness against
 * every explicitly assigned note bullet, requirement preservation). Both the
 * blocking path and the streaming route's `done` pass go through here, so the
 * guarantees can't drift between delivery modes.
 */
export function finalizeExtraction(
  content: string,
  input: ExtractTasksInput,
  meta?: AiCallMeta
): ExtractTasksResult {
  // Parse against the SAME vocabulary the request constrained the model to —
  // parsing a repo-area response against the fallback taxonomy would reject
  // every draft as an invalid enum value and salvage nothing.
  const slugs = areaSlugs(input);
  let parsed: ExtractTasksResult;
  try {
    parsed = parseExtractionResult(content, slugs);
  } catch (strictError) {
    // Malformed output is salvaged, not silently dropped.
    parsed = parseExtractionResultLenient(content, slugs);
    console.warn(
      `[extract-tasks] strict parse failed, salvaged ${parsed.items.length} items leniently:`,
      strictError instanceof Error ? strictError.message : strictError
    );
  }
  const grounded = reconstructAllSourceText(parsed.items, {
    summary: input.summary,
    transcript: input.transcript,
  });
  const { items, repairs } = postProcessExtraction(grounded, {
    notes: input.summary || input.transcript,
    builderAliases: input.builderName ? [input.builderName] : [],
  });
  logRepairs(repairs, meta);
  return { items };
}

export async function extractTasksFromTranscript(
  input: ExtractTasksInput,
  meta?: AiCallMeta
): Promise<ExtractTasksResult> {
  const response = await runChat(buildExtractionParams(input), meta);
  try {
    return finalizeExtraction(response.choices[0]?.message?.content ?? "", input, meta);
  } catch (firstError) {
    // Even the lenient parser found nothing usable — retry the generation once
    // before surfacing an error (transient truncation/malformation recovery).
    console.warn("[extract-tasks] unusable response, retrying generation once:", firstError);
    const retry = await runChat(buildExtractionParams(input), meta);
    return finalizeExtraction(retry.choices[0]?.message?.content ?? "", input, meta);
  }
}
