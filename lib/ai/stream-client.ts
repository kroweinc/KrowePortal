/**
 * Client-side consumer for the SSE generation routes (app/api/ai/{prd,quote}/stream).
 * Browser-only: uses fetch + ReadableStream. No server imports beyond erased types,
 * so it's safe to pull into a "use client" wizard.
 */

import type { ExtractedTaskDraft, Question } from "@/lib/ai/schemas";

/** The terminal event of a stream — what the wizard acts on. */
export type StreamFinal =
  | { type: "questions"; items: Question[] }
  | { type: "done"; prdId?: string; quoteId?: string }
  | { type: "error"; error: string };

type WireEvent = { type: "delta"; text: string } | StreamFinal;

/**
 * POST `body` to an SSE generation route and consume the stream, resolving with
 * the terminal event. Pre-stream failures (auth, validation, streaming-disabled)
 * come back as a JSON body and surface as an `error` event. Aborting `opts.signal`
 * cancels the fetch (and the server generation); the resulting AbortError
 * propagates to the caller to handle alongside its gen token.
 */
export async function streamDraft(
  url: string,
  body: unknown,
  opts: { signal: AbortSignal }
): Promise<StreamFinal> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  const ctype = res.headers.get("content-type") ?? "";
  if (!res.ok || ctype.includes("application/json")) {
    let error = `Generation failed (${res.status}).`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) error = j.error;
    } catch {
      // non-JSON error body — keep the status-based message
    }
    return { type: "error", error };
  }
  if (!res.body) return { type: "error", error: "No response stream." };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final: StreamFinal | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      let evt: WireEvent;
      try {
        evt = JSON.parse(payload) as WireEvent;
      } catch {
        continue;
      }
      // Text deltas only drove the (now removed) section checklist — ignore them
      // and act on the terminal event.
      if (evt.type !== "delta") final = evt;
    }
  }

  return final ?? { type: "error", error: "The generation ended unexpectedly." };
}

// ── Task-extraction stream (app/api/ai/granola/extract-tasks/stream) ────────

/** Terminal outcome of a task-draft stream. `unavailable` means the route
    can't serve it (flag off / network cut mid-stream) and the caller should
    fall back to the blocking server action. */
export type TaskDraftStreamFinal =
  | { type: "done"; drafts: ExtractedTaskDraft[] }
  | { type: "error"; error: string }
  | { type: "unavailable" };

type TaskDraftWireEvent =
  | { type: "meta"; noteTitle: string | null; noteCreatedAt: string | null }
  | { type: "task"; item: ExtractedTaskDraft }
  | { type: "done"; drafts: ExtractedTaskDraft[] }
  | { type: "error"; error: string };

/**
 * POST to the task-extraction SSE route and consume the stream, invoking
 * `onMeta`/`onTask` as events arrive and resolving with the terminal event.
 * Per-item events are display-only — the `done` drafts array is authoritative.
 * Pre-AI failures (auth, budget, Granola errors) arrive as a JSON body and
 * surface as an `error`; an AbortError from `opts.signal` propagates.
 */
export async function streamTaskDrafts(
  url: string,
  body: unknown,
  opts: {
    signal: AbortSignal;
    onMeta?: (meta: { noteTitle: string | null; noteCreatedAt: string | null }) => void;
    onTask?: (item: ExtractedTaskDraft) => void;
  }
): Promise<TaskDraftStreamFinal> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    // Network failure before any stream — let the blocking action handle it.
    return { type: "unavailable" };
  }

  // 404 = streaming flag off (or route missing) — silent fallback, not an error.
  if (res.status === 404) return { type: "unavailable" };
  const ctype = res.headers.get("content-type") ?? "";
  if (!res.ok || ctype.includes("application/json")) {
    let error = `Drafting failed (${res.status}).`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) error = j.error;
    } catch {
      // non-JSON error body — keep the status-based message
    }
    return { type: "error", error };
  }
  if (!res.body) return { type: "unavailable" };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final: TaskDraftStreamFinal | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      let evt: TaskDraftWireEvent;
      try {
        evt = JSON.parse(payload) as TaskDraftWireEvent;
      } catch {
        continue;
      }
      if (evt.type === "meta") opts.onMeta?.(evt);
      else if (evt.type === "task") opts.onTask?.(evt.item);
      else final = evt;
    }
  }

  // Stream cut before a terminal event (network drop) — fall back to blocking.
  return final ?? { type: "unavailable" };
}
