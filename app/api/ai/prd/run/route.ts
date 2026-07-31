import { NextRequest, NextResponse, after } from "next/server";

import { getCurrentProfile } from "@/lib/auth";
import { assertAiBudget } from "@/lib/ai/usage";
import { friendlyAiError } from "@/lib/ai/client";
import { resolvePrdDraft, persistPrdDraft, isEmptyPrdContent, type DraftPrdInput } from "@/lib/prd/draft-core";
import { streamPrdGeneration } from "@/lib/prd/stream-generation";
import { claimRun, heartbeatRun, insertMessage, loadRun, setRunPhase, setRunPrdId } from "@/lib/agent/store";
import type { AgentPrdWidget } from "@/lib/agent/types";

// Durable SSE route for a PRD generation run (agent_runs kind='prd'). One POST =
// generate the run's stored DraftPrdInput once: claim it, stream section-granular
// progress into a `sink`, persist the finished PRD + a run widget, flip the phase
// to done. Like the chat route, the whole consumption is registered with `after()`
// so navigating away / refreshing / closing the tab no longer discards the work —
// the run finishes server-side and its result + phase persist for the topbar dock.
// Node runtime for the OpenAI SDK stream; no-transform keeps proxies from buffering.
export const runtime = "nodejs";
// PRD generation (up to 32k tokens) runs longer than a chat turn — give `after()`
// room; getActiveRuns' stale sweep reconciles anything that still dies mid-run.
export const maxDuration = 300;

const PRD_SECTION_TOTAL = 22;

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const runId = typeof body.runId === "string" ? body.runId : "";
  if (!runId) return NextResponse.json({ error: "runId is required." }, { status: 400 });

  // Auth + load gate the HTTP status (can't downgrade a committed 200 stream).
  const [profile, run] = await Promise.all([getCurrentProfile(), loadRun(runId)]);
  if (!profile) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (profile.role !== "builder") return NextResponse.json({ error: "Builder only." }, { status: 403 });
  if (!run || run.kind !== "prd" || !run.prdInput) {
    return NextResponse.json({ error: "PRD run not found." }, { status: 404 });
  }
  if (run.builderId !== profile.id) return NextResponse.json({ error: "Not your run." }, { status: 403 });

  const budget = await assertAiBudget(profile.id);
  if (!budget.ok) return NextResponse.json({ error: budget.error }, { status: 429 });

  // Resolve in REQUEST scope (cookies/RLS) BEFORE the durable stream: re-validates
  // project ownership, gathers materials, builds genInput + the save context. The
  // generation + persist that follow run under `after()` and use the admin client.
  const resolved = await resolvePrdDraft(run.prdInput as DraftPrdInput);
  if (!resolved.ok) {
    await setRunPhase(runId, "error", "error");
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }
  const { genInput, save } = resolved;
  const title = save.title;

  // Atomically claim the run — a concurrent POST (a refresh mid-run) loses and 409s
  // rather than double-running the model. Claim sets phase=reading.
  if (!(await claimRun(runId))) {
    return NextResponse.json({ error: "This PRD is already generating." }, { status: 409 });
  }

  const encoder = new TextEncoder();
  let sink: ((e: unknown) => void) | null = null;
  const early: unknown[] = [];
  const emit = (e: unknown) => {
    if (sink) sink(e);
    else early.push(e);
  };

  // Drive generation ONCE — never depends on the client connection.
  async function runAndPersist(): Promise<void> {
    let composing = false;
    let lastBeat = 0;
    try {
      const gen = streamPrdGeneration(genInput, { userId: profile!.id, operation: "generate_prd" });
      let step = await gen.next();
      while (!step.done) {
        const ev = step.value;
        if (ev.type === "delta") {
          // First token → advance to composing; then throttled liveness so the stale
          // sweep can tell a long generation from a dead run (deltas aren't persisted).
          if (!composing) {
            composing = true;
            await setRunPhase(runId, "composing");
            emit({ type: "phase", phase: "composing" });
          }
          const now = performance.now();
          if (now - lastBeat > 10_000) {
            lastBeat = now;
            void heartbeatRun(runId);
          }
        } else if (ev.type === "section") {
          emit({ type: "section", key: ev.key, sectionsSeen: ev.sectionsSeen });
        } else if (ev.type === "content") {
          emit({ type: "content", partial: ev.partial });
        }
        step = await gen.next();
      }

      const result = step.value; // PrdGenResult (the generator's return)
      if (result.kind !== "prd" || isEmptyPrdContent(result.content)) {
        await setRunPhase(runId, "error", "error");
        emit({ type: "error", error: "The PRD came back empty — generation didn't finish. Please try again." });
        return;
      }

      // Persist via the admin client — the request has closed, so no cookies. Ownership
      // was authorized above in request scope.
      const saved = await persistPrdDraft(save, result.content, result.contextSummary, { admin: true });
      if ("error" in saved) {
        await setRunPhase(runId, "error", "error");
        emit({ type: "error", error: saved.error });
        return;
      }

      await setRunPrdId(runId, saved.prdId);
      const widget: AgentPrdWidget = {
        type: "prd",
        prdId: saved.prdId,
        projectId: save.projectId,
        title,
        content: result.content,
        sectionsSeen: PRD_SECTION_TOTAL,
        sectionsTotal: PRD_SECTION_TOTAL,
      };
      const msg = await insertMessage({
        runId,
        role: "assistant",
        content: `Drafted **${title}** — your PRD is ready.`,
        widgets: [widget],
      });
      await setRunPhase(runId, "done", "done");
      emit({ type: "done", prdId: saved.prdId, widget, messageId: msg?.id });
    } catch (err) {
      try {
        await setRunPhase(runId, "error", "error");
      } catch {
        // best-effort status
      }
      emit({ type: "error", error: friendlyAiError(err) });
    }
  }

  const enginePromise = runAndPersist();
  // Keep the invocation alive until generation finishes, even after the client
  // disconnects — this is what makes the PRD run durable (the old inline route
  // aborted + discarded on disconnect).
  after(() => enginePromise.catch(() => {}));

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      sink = (e) => {
        try {
          controller.enqueue(encoder.encode(sse(e)));
        } catch {
          // controller closed (client gone) — engine keeps running under after()
        }
      };
      for (const e of early) sink(e);
      early.length = 0;
      enginePromise.finally(() => {
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      // Client left; stop enqueuing but let generation finish server-side.
      sink = null;
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
