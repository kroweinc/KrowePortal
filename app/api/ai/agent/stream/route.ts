import { NextRequest, NextResponse, after } from "next/server";

import { getCurrentProfile } from "@/lib/auth";
import { assertEngagementBuilder } from "@/lib/context/access";
import { assertAiBudget } from "@/lib/ai/usage";
import { friendlyAiError } from "@/lib/ai/client";
import { buildClientContext, serializeForPrompt } from "@/lib/context/buildClientContext";
import { runContextAgent } from "@/lib/agent/runContextAgent";
import { resolvePageContext } from "@/lib/agent/page-context";
import {
  claimRun,
  heartbeatRun,
  insertMessage,
  loadRun,
  loadRunMessages,
  projectOwnedByBuilder,
  setRunPageContext,
  setRunPhase,
  setRunProject,
} from "@/lib/agent/store";
import type { AgentPhase, AgentSource } from "@/lib/agent/types";

// SSE route for the Agents Control Center. One POST = one grounded turn on an
// existing run: claim the run, persist the user message, retrieve + serialize the
// client's context (in request scope — getCurrentProfile/cookies can't run
// mid-stream), then stream the model's deltas / tool activity / terminal answer.
//
// Durable + parallel: the turn is driven ONCE into a `sink` that is the live
// controller while a client is connected and a no-op after it disconnects, and
// the whole consumption is registered with `after()` so the platform keeps the
// invocation alive to completion. Closing the ⌘K palette, navigating, or
// refreshing no longer aborts the run — it finishes server-side and its result +
// phase persist for the floating progress-ring dock (and any later reload). Node
// runtime so the OpenAI SDK stream behaves; no-transform keeps proxies from
// buffering.
export const runtime = "nodejs";
// Bound the background completion. A turn (≤4 tool rounds, 1500 tokens,
// reasoning_effort none) finishes in seconds; this ceiling lets `after()` hold
// the invocation open long enough, and getActiveRuns' stale sweep reconciles
// anything that still dies mid-turn.
export const maxDuration = 60;

// Order of the three streaming phases, so phase only ever advances (a delta
// after retrieval must not drag the ring back to "searching").
const PHASE_ORDER: Record<string, number> = { reading: 0, searching: 1, composing: 2 };

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
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const k = typeof body.k === "number" && Number.isFinite(body.k) ? body.k : undefined;
  // A human label for the page the turn was fired from — the agent leans
  // ambiguous requests toward it. Absent for the neutral hub/agent surfaces; a
  // turn that supplies none inherits the run's sticky page below.
  const rawPage = typeof body.page === "string" && body.page.trim() ? body.page.trim() : undefined;
  // The project the builder is viewing (a document page), so the document tools
  // scope to it. Validated as a UUID here; ownership is verified below before we
  // trust it. Absent off document pages.
  const UUID_RE = /^[0-9a-f-]{36}$/i;
  const rawProjectId =
    typeof body.projectId === "string" && UUID_RE.test(body.projectId) ? body.projectId : undefined;
  // The specific document the builder is viewing, so an untitled "change the
  // document" request assumes it. Ownership isn't checked here — the doc tools
  // scope every lookup by created_by = builderId, so a spoofed id resolves to
  // nothing rather than leaking another builder's doc.
  const viewedDocKind =
    body.viewedDocKind === "prd" || body.viewedDocKind === "quote" || body.viewedDocKind === "contract"
      ? (body.viewedDocKind as "prd" | "quote" | "contract")
      : undefined;
  const viewedDocId =
    typeof body.viewedDocId === "string" && UUID_RE.test(body.viewedDocId) ? body.viewedDocId : undefined;
  const clientViewedDoc =
    viewedDocKind && viewedDocId ? { kind: viewedDocKind, id: viewedDocId } : undefined;
  // The PRD section the builder is scrolled to (e.g. "techStack"), so an ambiguous
  // section change ("change the tech stack") assumes it. Per-turn, not sticky —
  // the PRD page always re-derives it, and it's meaningless off a document page.
  const viewedSection =
    typeof body.viewedSection === "string" && body.viewedSection.trim()
      ? body.viewedSection.trim()
      : undefined;
  if (!runId || !message) {
    return NextResponse.json({ error: "runId and message are required." }, { status: 400 });
  }

  // Auth gate — parallelized where independent. getCurrentProfile (React-cached)
  // and loadRun don't depend on each other; the ownership + budget checks depend
  // only on their results. These gate the HTTP status code, so they stay ahead of
  // the stream (you can't downgrade a committed 200 text/event-stream to a 403).
  const [profile, run] = await Promise.all([getCurrentProfile(), loadRun(runId)]);
  if (!profile) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (profile.role !== "builder") return NextResponse.json({ error: "Builder only." }, { status: 403 });
  if (!run) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  // This route serves grounded chat turns; a PRD run streams over its own route.
  if (run.kind !== "chat" || !run.engagementId) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }
  const engagementId = run.engagementId;

  const [ownsEngagement, budget] = await Promise.all([
    assertEngagementBuilder(engagementId, profile.id),
    assertAiBudget(profile.id),
  ]);
  if (!ownsEngagement) return NextResponse.json({ error: "Not your client." }, { status: 403 });
  if (!budget.ok) return NextResponse.json({ error: budget.error }, { status: 429 });

  // Resolve the project the document tools scope to: a newly-viewed project the
  // builder owns (persisted onto the run so the deferred confirm step sees it
  // too), else the run's sticky project from an earlier document-page turn.
  let projectId = run.projectId ?? undefined;
  if (rawProjectId && rawProjectId !== run.projectId && (await projectOwnedByBuilder(rawProjectId, profile.id))) {
    await setRunProject(runId, rawProjectId);
    projectId = rawProjectId;
  }

  // Same sticky treatment for the page hint + viewed document (resolvePageContext):
  // a turn that supplies a new page/document adopts and pins it; a follow-up that
  // supplies none — sent from the neutral agent workspace, where the client can't
  // re-derive it — inherits what the run remembers. This is what keeps the chat's
  // page context alive across follow-ups instead of resetting each turn.
  const { page, viewedDoc, patch: ctxPatch } = resolvePageContext(
    { page: rawPage, viewedDoc: clientViewedDoc },
    { page: run.page, viewedDoc: run.viewedDoc }
  );
  if (ctxPatch.page !== undefined || ctxPatch.viewedDoc !== undefined) {
    await setRunPageContext(runId, ctxPatch);
  }

  // Atomically claim the turn BEFORE inserting anything. If a concurrent POST (a
  // refresh mid-run) is already executing this run, claimRun returns false and we
  // 409 without duplicating the user message or double-running the model. The
  // claim also sets phase=reading, which spans the grounding retrieval below.
  if (!(await claimRun(runId))) {
    return NextResponse.json({ error: "This turn is already running." }, { status: 409 });
  }

  // Everything before the first token runs HERE (request scope) — grounding
  // resolves getCurrentProfile()/cookies (RLS Supabase client) internally, so it
  // can't move into the background task. These three are independent, so they fan
  // out: grounding (the long pole, pre-authorized with `profile`), persisting the
  // user turn then replaying history.
  let serialized: string;
  let baseSources: AgentSource[];
  let history: { role: "user" | "assistant"; content: string }[];
  try {
    const [bundle, replayed] = await Promise.all([
      buildClientContext(engagementId, { query: message, k }, { profile }),
      (async () => {
        await insertMessage({ runId, role: "user", content: message });
        const prior = await loadRunMessages(runId);
        return prior
          .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim())
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
      })(),
    ]);
    serialized = serializeForPrompt(bundle);
    baseSources = (bundle.snippets ?? []).map((s) => ({
      title: s.itemTitle,
      kind: s.itemKind,
      similarity: s.similarity,
    }));
    history = replayed;
  } catch (err) {
    await setRunPhase(runId, "error", "error");
    return NextResponse.json({ error: friendlyAiError(err) }, { status: 502 });
  }

  const encoder = new TextEncoder();
  // The live view is a *sink*: set to the controller while a client is attached,
  // null after it disconnects. The engine keeps running either way; when there's
  // no sink its output is simply persisted, not streamed.
  let sink: ((e: unknown) => void) | null = null;
  const early: unknown[] = []; // events emitted before start() subscribes
  const emit = (e: unknown) => {
    if (sink) sink(e);
    else early.push(e);
  };

  // Drive the turn ONCE: forward each event to the (possibly absent) sink, write
  // phase transitions durably, and persist the terminal assistant turn + status.
  // Never depends on the client connection.
  async function runAndPersist(): Promise<void> {
    let currentPhase: AgentPhase = "reading";
    let lastBeat = 0;
    const advance = async (p: "searching" | "composing") => {
      if ((PHASE_ORDER[currentPhase] ?? 0) >= PHASE_ORDER[p]) return;
      currentPhase = p;
      await setRunPhase(runId, p);
      emit({ type: "phase", phase: p });
    };

    try {
      for await (const event of runContextAgent({
        engagementId,
        builderId: profile!.id,
        profile: profile!,
        serialized,
        baseSources,
        history,
        page,
        projectId,
        viewedDoc,
        viewedSection,
      })) {
        if (event.type === "delta") {
          await advance("composing");
          // Throttled liveness — deltas aren't persisted, so without this the
          // stale sweep couldn't tell a long compose from a dead run.
          const now = performance.now();
          if (now - lastBeat > 10_000) {
            lastBeat = now;
            void heartbeatRun(runId);
          }
          emit(event);
          continue;
        }

        if (event.type === "tool") {
          if (event.phase === "start") await advance("searching");
          emit(event);
          continue;
        }

        if (event.type === "final") {
          const saved = await insertMessage({
            runId,
            role: "assistant",
            content: event.content,
            sources: event.sources,
            widgets: event.widgets ?? null,
          });
          await setRunPhase(runId, "done", "done");
          emit({
            type: "final",
            content: event.content,
            sources: event.sources,
            widgets: event.widgets,
            messageId: saved?.id,
          });
          return;
        }

        if (event.type === "proposal") {
          const saved = await insertMessage({
            runId,
            role: "assistant",
            content: event.content,
            toolCalls: event.toolCalls,
            toolStatus: "proposed",
            sources: event.sources,
            widgets: event.widgets ?? null,
          });
          // Phase stays composing; the ring reads the awaiting state off status.
          await setRunPhase(runId, "composing", "awaiting_input");
          emit({
            type: "proposal",
            content: event.content,
            toolCalls: event.toolCalls,
            sources: event.sources,
            widgets: event.widgets,
            messageId: saved?.id,
          });
          return;
        }

        if (event.type === "error") {
          await setRunPhase(runId, "error", "error");
          emit(event);
          return;
        }

        emit(event); // status / sources / phase passthrough
      }
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
  // Keep the invocation alive until the turn finishes, even after the client
  // disconnects — this is what makes the run durable.
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
      // Client left; stop enqueuing but let the engine finish server-side.
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
