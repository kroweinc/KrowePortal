import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  resolveGranolaDraft,
  gateTranscriptTaskDrafting,
} from "@/lib/granola/draft-core";
import { stageTimer } from "@/lib/granola/timing";
import { runChat, runChatStream, STREAMING_ENABLED, friendlyAiError } from "@/lib/ai/client";
import {
  buildExtractionParams,
  finalizeExtraction,
  type ExtractTasksInput,
} from "@/lib/ai/extract-tasks-from-transcript";
import { createItemsScanner } from "@/lib/ai/stream-items";
import { ExtractedTaskDraft } from "@/lib/ai/schemas";
import { stripNullsDeep } from "@/lib/ai/strict-schema";
import type { AiCallMeta } from "@/lib/ai/usage";
import { MAX_SOP_CHARS } from "@/lib/attachments-constants";

// SSE streaming variant of draftTasksFromGranolaNote / draftTasksFromPastedTranscript
// (lib/actions/granola-import.ts). Same gates and byte-identical extraction params
// via the shared cores (lib/granola/draft-core.ts, buildExtractionParams) — this
// route only changes DELIVERY: drafts render in the review dialog one by one as the
// model emits them, instead of behind a 10-30s spinner. The `done` event re-parses
// the full accumulated JSON with the same validator as the blocking path and is
// authoritative; per-item `task` events are display-only. Pinned to the Node runtime
// so request.signal abort + the OpenAI SDK stream behave; no-transform keeps proxies
// from buffering the stream.
export const runtime = "nodejs";

const bodySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("granola"),
    engagementId: z.string().uuid(),
    noteId: z.string().min(1).max(200),
  }),
  z.object({
    kind: z.literal("paste"),
    engagementId: z.string().uuid(),
    content: z.string().trim().min(1).max(MAX_SOP_CHARS),
    label: z.string().trim().max(200).optional(),
  }),
]);

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: NextRequest) {
  if (!STREAMING_ENABLED) {
    return NextResponse.json({ error: "Streaming is disabled." }, { status: 404 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const body = bodySchema.safeParse(raw);
  if (!body.success) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const timer = stageTimer("granola-draft-stream");

  // Resolve gates + transcript through the same cores as the blocking actions.
  let extractInput: ExtractTasksInput;
  let meta: AiCallMeta;
  let noteTitle: string | null;
  let noteCreatedAt: string | null;
  if (body.data.kind === "granola") {
    const resolved = await resolveGranolaDraft(body.data.engagementId, body.data.noteId, timer);
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }
    ({ extractInput, meta, noteTitle, noteCreatedAt } = resolved);
  } else {
    const gate = await gateTranscriptTaskDrafting(body.data.engagementId);
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }
    noteTitle = body.data.label?.trim() || null;
    noteCreatedAt = null;
    extractInput = {
      noteTitle,
      summary: null,
      transcript: body.data.content,
      participants: null,
      builderName: gate.builderName,
    };
    meta = {
      userId: gate.profileId,
      operation: "transcript_extract_tasks",
      engagementId: gate.engagementId,
    };
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(sse(data)));
      let full = "";
      try {
        send({ type: "meta", noteTitle, noteCreatedAt });

        const scan = createItemsScanner();
        const deltas = runChatStream(buildExtractionParams(extractInput), meta);
        for await (const delta of deltas) {
          if (request.signal.aborted) break;
          full += delta;
          for (const item of scan(delta)) {
            // Same normalization + schema as the final validator; anything that
            // doesn't parse is silently held for the authoritative `done` pass.
            // Every draft is treated as the builder's own work in the review UI
            // (all rows start checked), so nothing is filtered during parse.
            const parsed = ExtractedTaskDraft.safeParse(stripNullsDeep(item));
            if (parsed.success) {
              send({ type: "task", item: parsed.data });
            }
          }
        }

        // Client cancelled mid-stream — stop without a terminal event.
        if (request.signal.aborted) {
          controller.close();
          return;
        }
        timer.mark("ai");

        // The full-document finalize is authoritative — the client replaces its
        // progressive list with this array. finalizeExtraction runs the same
        // strict→lenient parse + completeness/dedup/attribution safety net as
        // the blocking path; a stream even the lenient parser can't salvage
        // gets ONE fresh non-streaming generation before surfacing an error —
        // not extractTasksFromTranscript, whose internal retry would make the
        // worst case three model calls for a single request.
        let result;
        try {
          result = finalizeExtraction(full, extractInput, meta);
        } catch {
          const retry = await runChat(buildExtractionParams(extractInput), meta);
          result = finalizeExtraction(retry.choices[0]?.message?.content ?? "", extractInput, meta);
        }
        timer.done(`drafts=${result.items.length}`);
        send({ type: "done", drafts: result.items });
        controller.close();
      } catch (err) {
        console.error("[granola extract-tasks stream]", err);
        try {
          send({ type: "error", error: friendlyAiError(err) });
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
