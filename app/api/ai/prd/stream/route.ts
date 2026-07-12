import { NextRequest, NextResponse } from "next/server";
import { resolvePrdDraft, persistPrdDraft, isEmptyPrdContent, type DraftPrdInput } from "@/lib/prd/draft-core";
import { runChatStream, STREAMING_ENABLED, AI_MODEL, friendlyAiError } from "@/lib/ai/client";
import { buildPrdPrompts, prdResponseFormat, parsePrdResult, dedupeQuestions, generatePrd, PRD_MAX_TOKENS, OPENER_QUESTION } from "@/lib/ai/generate-prd";

// SSE streaming variant of the draftPrd action (lib/actions/prds.ts). Streams the
// model's text deltas to the wizard for progressive display, then parses + saves
// the finished PRD exactly once (reusing the shared core), so a streamed
// generation is never produced twice. Question rounds resolve to a single
// `questions` event. Pinned to the Node runtime so request.signal abort + the
// OpenAI SDK stream behave; no-transform keeps proxies from buffering the stream.
export const runtime = "nodejs";

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: NextRequest) {
  if (!STREAMING_ENABLED) {
    return NextResponse.json({ error: "Streaming is disabled." }, { status: 404 });
  }

  let body: DraftPrdInput;
  try {
    body = (await request.json()) as DraftPrdInput;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const resolved = await resolvePrdDraft(body);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }
  const { genInput, save, profile } = resolved;
  const encoder = new TextEncoder();

  // No-notes round 0: emit the fixed opener as a single questions event and stop
  // — no AI call. Mirrors the blocking draftPrd short-circuit so both paths behave
  // identically (the builder's idea is captured before any questions are generated).
  if (resolved.openerRound) {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(sse({ type: "questions", items: [OPENER_QUESTION] })));
        controller.close();
      },
    });
    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  const { systemPrompt, userPrompt } = buildPrdPrompts(genInput);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = "";
      try {
        const deltas = runChatStream(
          {
            model: AI_MODEL,
            max_completion_tokens: PRD_MAX_TOKENS,
            response_format: prdResponseFormat(genInput.forceFinal),
            // Shares the static system prefix with the blocking path — same key so
            // both hit the same cached prefix (see callOpenAI in generate-prd.ts).
            prompt_cache_key: "prd-gen-v1",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
          },
          { userId: profile.id, operation: "generate_prd" }
        );

        for await (const delta of deltas) {
          if (request.signal.aborted) break;
          full += delta;
          controller.enqueue(encoder.encode(sse({ type: "delta", text: delta })));
        }

        // Client cancelled mid-stream — stop without saving anything.
        if (request.signal.aborted) {
          controller.close();
          return;
        }

        const parsed = parsePrdResult(full, genInput.forceFinal);
        if (parsed.kind === "questions") {
          // Drop questions already answered (or repeated within the round) so the
          // no-context flow never re-asks them — notably the fixed fallback questions,
          // which can be re-served on a later degraded round.
          const items = dedupeQuestions(parsed.items, genInput.answers);
          if (items.length > 0) {
            controller.enqueue(encoder.encode(sse({ type: "questions", items })));
            controller.close();
            return;
          }
          // Nothing new to ask — fall through to finalize below rather than emitting
          // an empty round or re-showing answered questions.
        }

        // Either the model returned a finished PRD, or a question round with nothing
        // new to ask — in the latter case finalize (forceFinal resolves only to a
        // "prd" result, so no empty/repeat round ever reaches the builder).
        let result =
          parsed.kind === "prd"
            ? parsed
            : await generatePrd({ ...genInput, forceFinal: true }, { userId: profile.id, operation: "generate_prd" });

        // A STREAMED final round can truncate mid-JSON and degrade to an empty draft
        // ({ content: {} }) — don't persist that blank. Recover with one blocking
        // forced-final attempt (which retries and re-uses the strict schema) before
        // giving up; persistPrdDraft still refuses an empty result as a last resort.
        if (result.kind === "prd" && isEmptyPrdContent(result.content)) {
          result = await generatePrd({ ...genInput, forceFinal: true }, { userId: profile.id, operation: "generate_prd" });
        }
        if (result.kind !== "prd") {
          // Defensive: forceFinal cannot return questions, but keep the stream honest.
          controller.enqueue(encoder.encode(sse({ type: "error", error: "Failed to finalize PRD." })));
          controller.close();
          return;
        }

        const saved = await persistPrdDraft(save, result.content, result.contextSummary);
        controller.enqueue(
          encoder.encode("error" in saved ? sse({ type: "error", error: saved.error }) : sse({ type: "done", prdId: saved.prdId }))
        );
        controller.close();
      } catch (err) {
        try {
          controller.enqueue(encoder.encode(sse({ type: "error", error: friendlyAiError(err) })));
          controller.close();
        } catch {
          // controller already closed (e.g. client gone) — nothing to do.
        }
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
