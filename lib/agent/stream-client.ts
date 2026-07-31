"use client";

import type { AgentEvent, PrdRunEvent } from "./types";

// Lean browser reader for the agent SSE route. POSTs a turn and invokes onEvent
// for each `data: {…}` frame. (lib/ai/stream-client.ts is PRD-partial-object
// shaped; this one just forwards flat AgentEvents.)
export async function streamAgentTurn(
  body: {
    runId: string;
    message: string;
    k?: number;
    page?: string;
    projectId?: string;
    viewedDocKind?: "prd" | "quote" | "contract";
    viewedDocId?: string;
    viewedSection?: string;
  },
  onEvent: (event: AgentEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/ai/agent/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return;
    onEvent({ type: "error", error: "Network error. Check your connection and try again." });
    return;
  }

  if (!res.ok || !res.body) {
    let msg = `Request failed (${res.status}).`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      // non-JSON error body — keep the status message
    }
    onEvent({ type: "error", error: msg });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      const frames = buf.split("\n\n");
      buf = frames.pop() ?? ""; // trailing partial frame stays buffered
      for (const frame of frames) {
        const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        const json = dataLine.slice(5).trim();
        if (!json) continue;
        try {
          onEvent(JSON.parse(json) as AgentEvent);
        } catch {
          // skip malformed frame
        }
      }
    }
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return;
    onEvent({ type: "error", error: "The connection dropped. Try again." });
  }
}

// Reader for the durable PRD run route (app/api/ai/prd/run). POSTs just the runId
// (the DraftPrdInput lives on the run) and forwards each PrdRunEvent frame. Mirrors
// streamAgentTurn; a 409 means the run is already generating server-side, so we
// detach quietly and let the provider's poll reconcile rather than surfacing an
// error.
export async function streamPrdRun(
  runId: string,
  onEvent: (event: PrdRunEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/ai/prd/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId }),
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return;
    onEvent({ type: "error", error: "Network error. Check your connection and try again." });
    return;
  }

  // Already generating (a refresh/second tab) — the durable run continues; the poll
  // will surface its real state.
  if (res.status === 409) return;
  if (!res.ok || !res.body) {
    let msg = `Request failed (${res.status}).`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      // non-JSON error body — keep the status message
    }
    onEvent({ type: "error", error: msg });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      const frames = buf.split("\n\n");
      buf = frames.pop() ?? "";
      for (const frame of frames) {
        const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        const json = dataLine.slice(5).trim();
        if (!json) continue;
        try {
          onEvent(JSON.parse(json) as PrdRunEvent);
        } catch {
          // skip malformed frame
        }
      }
    }
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return;
    onEvent({ type: "error", error: "The connection dropped. Try again." });
  }
}
