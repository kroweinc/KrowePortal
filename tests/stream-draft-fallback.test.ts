import { describe, it, expect, afterEach, vi } from "vitest";
import { streamDraft, generationErrorMessage } from "@/lib/ai/stream-client";

/**
 * A dropped connection at the moment a round is submitted (SSH tunnel blip, dev
 * server restart, flaky wifi) used to throw the browser's bare "Failed to fetch"
 * straight into a toast and lose the round. It must instead resolve to
 * `unavailable` so the wizard can re-run the round through the blocking action.
 */

function sseResponse(events: unknown[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const e of events) controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      controller.close();
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

const signal = new AbortController().signal;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamDraft", () => {
  it("resolves to `unavailable` when the request never reaches the route", async () => {
    // What the browser actually throws on a dropped connection.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const evt = await streamDraft("/api/ai/prd/stream", {}, { signal });

    expect(evt).toEqual({ type: "unavailable" });
  });

  it("still propagates an abort so cancel is not mistaken for a network drop", async () => {
    const abortErr = Object.assign(new Error("The user aborted a request."), { name: "AbortError" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortErr));

    await expect(streamDraft("/api/ai/prd/stream", {}, { signal })).rejects.toThrow(/aborted/);
  });

  it("surfaces a mid-stream drop as an error, never `unavailable`", async () => {
    // Re-running blocking after a mid-stream drop could duplicate a saved draft.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: "delta", text: "{" })}\n\n`));
        controller.error(new TypeError("network error"));
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { headers: { "Content-Type": "text/event-stream" } })));

    const evt = await streamDraft("/api/ai/prd/stream", {}, { signal });

    expect(evt.type).toBe("error");
    expect(evt).toMatchObject({ error: expect.stringMatching(/connection dropped/i) });
  });

  it("passes a JSON error body through unchanged", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Streaming is disabled." }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    expect(await streamDraft("/api/ai/prd/stream", {}, { signal })).toEqual({
      type: "error",
      error: "Streaming is disabled.",
    });
  });

  it("returns the terminal event of a healthy stream", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse([{ type: "delta", text: "x" }, { type: "done", prdId: "p1" }])));

    expect(await streamDraft("/api/ai/prd/stream", {}, { signal })).toEqual({ type: "done", prdId: "p1" });
  });
});

describe("generationErrorMessage", () => {
  it("replaces the browser's bare network TypeError with actionable copy", () => {
    // Chrome says "Failed to fetch", Safari "Load failed" — both TypeErrors.
    for (const raw of ["Failed to fetch", "Load failed"]) {
      const msg = generationErrorMessage(new TypeError(raw), "Generation failed.");
      expect(msg).not.toContain(raw);
      expect(msg).toMatch(/try again/i);
    }
  });

  it("keeps a real server-side message", () => {
    expect(generationErrorMessage(new Error("You've hit today's AI budget."), "Generation failed.")).toBe(
      "You've hit today's AI budget."
    );
  });

  it("falls back when there is no message to show", () => {
    expect(generationErrorMessage({}, "Generation failed.")).toBe("Generation failed.");
  });
});
