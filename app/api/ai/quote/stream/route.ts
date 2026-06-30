import { NextRequest, NextResponse } from "next/server";
import { resolveQuoteDraft, persistQuoteDraft, type DraftQuoteInput } from "@/lib/quote/draft-core";
import { runChatStream, STREAMING_ENABLED, AI_MODEL, friendlyAiError } from "@/lib/ai/client";
import { buildQuotePrompts, quoteResponseFormat, parseQuoteResult, QUOTE_MAX_TOKENS } from "@/lib/ai/generate-quote";

// SSE streaming variant of the draftQuote action (lib/actions/quote-docs.ts).
// Streams text deltas to the wizard, then parses + saves the finished quote
// exactly once via the shared core (which ties out pricing/totals). Question
// rounds resolve to a single `questions` event. See the PRD route for the runtime
// + header rationale.
export const runtime = "nodejs";

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: NextRequest) {
  if (!STREAMING_ENABLED) {
    return NextResponse.json({ error: "Streaming is disabled." }, { status: 404 });
  }

  let body: DraftQuoteInput;
  try {
    body = (await request.json()) as DraftQuoteInput;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const resolved = await resolveQuoteDraft(body);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }
  const { genInput, save, profile } = resolved;
  const { systemPrompt, userPrompt } = buildQuotePrompts(genInput);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = "";
      try {
        const deltas = runChatStream(
          {
            model: AI_MODEL,
            max_completion_tokens: QUOTE_MAX_TOKENS,
            response_format: quoteResponseFormat(genInput.forceFinal),
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
          },
          { userId: profile.id, operation: "generate_quote" }
        );

        for await (const delta of deltas) {
          if (request.signal.aborted) break;
          full += delta;
          controller.enqueue(encoder.encode(sse({ type: "delta", text: delta })));
        }

        if (request.signal.aborted) {
          controller.close();
          return;
        }

        const result = parseQuoteResult(full, genInput);
        if (result.kind === "questions") {
          controller.enqueue(encoder.encode(sse({ type: "questions", items: result.items })));
          controller.close();
          return;
        }

        const saved = await persistQuoteDraft(save, result.content, result.contextSummary);
        controller.enqueue(
          encoder.encode("error" in saved ? sse({ type: "error", error: saved.error }) : sse({ type: "done", quoteId: saved.quoteId }))
        );
        controller.close();
      } catch (err) {
        try {
          controller.enqueue(encoder.encode(sse({ type: "error", error: friendlyAiError(err) })));
          controller.close();
        } catch {
          // controller already closed — nothing to do.
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
