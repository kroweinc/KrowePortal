import "server-only";

import { runChatStream, AI_MODEL } from "@/lib/ai/client";
import type { AiCallMeta } from "@/lib/ai/usage";
import {
  buildPrdPrompts,
  prdResponseFormat,
  parsePrdResult,
  dedupeQuestions,
  generatePrd,
  PRD_MAX_TOKENS,
  type PrdGenInput,
  type PrdGenResult,
} from "@/lib/ai/generate-prd";
import { createPrdSectionScanner } from "@/lib/ai/prd-section-scanner";
import { PrdSectionPatchSchema } from "@/lib/ai/schemas";
import { stripNullsDeep } from "@/lib/ai/strict-schema";
import { isEmptyPrdContent } from "@/lib/prd/draft-core";
import type { PrdContent } from "@/lib/types";

/**
 * Section-granular progress from a streaming PRD generation. `delta` is the raw
 * model text (drives liveness heartbeats only); `section` fires once per top-level
 * PRD key as it closes (drives the ring); `content` is the validated PRD-so-far
 * for live rendering (fires on each section boundary, ≤ ~22×, never per delta).
 */
export type PrdGenProgress =
  | { type: "delta"; text: string }
  | { type: "section"; key: string; sectionsSeen: number }
  | { type: "content"; partial: PrdContent };

/**
 * The generation core of app/api/ai/prd/stream, lifted so the durable run route
 * (app/api/ai/prd/run) drives an identical generation while emitting its own SSE
 * shape. An async generator: it yields section-granular progress and RETURNS the
 * finished PrdGenResult — parsing the envelope, deduping a question round against
 * prior answers, and recovering a truncated final round with one blocking
 * forced-final attempt (mirroring the inline route). Server-only (OpenAI SDK).
 *
 * Note: unlike the inline route, this never aborts mid-stream on client
 * disconnect — a durable run finishes server-side under `after()`.
 */
export async function* streamPrdGeneration(
  genInput: PrdGenInput,
  meta: AiCallMeta
): AsyncGenerator<PrdGenProgress, PrdGenResult> {
  const { systemPrompt, userPrompt } = buildPrdPrompts(genInput);
  const scan = createPrdSectionScanner();
  let full = "";
  let seen = 0;

  const deltas = runChatStream(
    {
      model: AI_MODEL,
      max_completion_tokens: PRD_MAX_TOKENS,
      response_format: prdResponseFormat(genInput.forceFinal),
      // Same static system prefix + cache key as the blocking/inline paths.
      prompt_cache_key: "prd-gen-v1",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    },
    meta
  );

  for await (const delta of deltas) {
    full += delta;
    yield { type: "delta", text: delta };
    const keys = scan(delta);
    for (const key of keys) {
      seen += 1;
      yield { type: "section", key, sectionsSeen: seen };
    }
    // On each section boundary, surface the PRD-so-far (complete sections only) as a
    // validated partial. safeContentBody() excludes the half-written current section,
    // so the wrapped body always parses; strict-mode nulls are stripped first.
    if (keys.length > 0) {
      const body = scan.safeContentBody();
      if (body) {
        try {
          const parsed = stripNullsDeep(JSON.parse(`{${body}}`));
          const validated = PrdSectionPatchSchema.safeParse(parsed);
          if (validated.success) yield { type: "content", partial: validated.data as PrdContent };
        } catch {
          // not cleanly parseable at this boundary — wait for the next section
        }
      }
    }
  }

  // A question round with new questions resolves as-is; otherwise finalize. forceFinal
  // never returns questions, so the PRD run (always a generation round) falls through
  // to a "prd" result.
  const parsed = parsePrdResult(full, genInput.forceFinal);
  if (parsed.kind === "questions") {
    const items = dedupeQuestions(parsed.items, genInput.answers);
    if (items.length > 0) return { kind: "questions", items };
  }

  // A STREAMED final round can truncate mid-JSON and degrade to an empty draft —
  // recover with one blocking forced-final attempt (which retries + re-uses the
  // strict schema) before giving up.
  let result: PrdGenResult =
    parsed.kind === "prd" ? parsed : await generatePrd({ ...genInput, forceFinal: true }, meta);
  if (result.kind === "prd" && isEmptyPrdContent(result.content)) {
    result = await generatePrd({ ...genInput, forceFinal: true }, meta);
  }
  return result;
}
