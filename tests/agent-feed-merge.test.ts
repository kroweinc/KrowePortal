import { describe, it, expect } from "vitest";
import { mergeFeed, isActiveStatus } from "@/lib/agent/feed";
import type { ActiveRun } from "@/lib/agent/types";
import type { QueueItem } from "@/components/agent/agent-runs-provider";

// mergeFeed reconciles durable server history (ActiveRun[]) with the provider's
// live runs (QueueItem[]): keyed by runId, live wins, active-first then recency.

function serverRun(over: Partial<ActiveRun> & { id: string }): ActiveRun {
  return {
    id: over.id,
    kind: over.kind ?? "chat",
    title: over.title ?? "Run " + over.id,
    clientName: over.clientName ?? "Acme",
    engagementId: over.engagementId ?? "e1",
    projectId: over.projectId ?? null,
    prdId: over.prdId ?? null,
    status: over.status ?? "done",
    phase: over.phase ?? "done",
    createdAt: over.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: over.updatedAt ?? "2026-01-01T00:00:00.000Z",
  };
}

function liveRun(over: Partial<QueueItem> & { runId: string }): QueueItem {
  return {
    runId: over.runId,
    kind: over.kind ?? "chat",
    engagementId: over.engagementId ?? "e1",
    projectId: over.projectId ?? null,
    prdId: over.prdId ?? null,
    clientName: over.clientName ?? "Acme",
    title: over.title ?? "Live " + over.runId,
    status: over.status ?? "thinking",
    phase: over.phase ?? "composing",
    prdSectionsSeen: over.prdSectionsSeen ?? 0,
    prdSectionsTotal: over.prdSectionsTotal ?? 22,
    startedAt: over.startedAt ?? 1000,
    finishedAt: over.finishedAt,
    error: over.error ?? null,
  };
}

describe("isActiveStatus", () => {
  it("counts in-flight + awaiting as active, terminal as not", () => {
    expect(isActiveStatus("thinking")).toBe(true);
    expect(isActiveStatus("running_tool")).toBe(true);
    expect(isActiveStatus("awaiting_input")).toBe(true);
    expect(isActiveStatus("done")).toBe(false);
    expect(isActiveStatus("error")).toBe(false);
    expect(isActiveStatus("idle")).toBe(false);
  });
});

describe("mergeFeed", () => {
  it("orders server-only history newest-first with live=false", () => {
    const rows = mergeFeed(
      [
        serverRun({ id: "a", updatedAt: "2026-01-01T00:00:00.000Z" }),
        serverRun({ id: "b", updatedAt: "2026-01-03T00:00:00.000Z" }),
        serverRun({ id: "c", updatedAt: "2026-01-02T00:00:00.000Z" }),
      ],
      []
    );
    expect(rows.map((r) => r.runId)).toEqual(["b", "c", "a"]);
    expect(rows.every((r) => r.live === false)).toBe(true);
  });

  it("adds a live-only run as a fresh row", () => {
    const rows = mergeFeed([], [liveRun({ runId: "x", status: "thinking" })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ runId: "x", live: true, status: "thinking" });
  });

  it("dedupes by runId — live wins on status/phase, appears once", () => {
    const rows = mergeFeed(
      [serverRun({ id: "dup", status: "thinking", phase: "reading" })],
      [liveRun({ runId: "dup", status: "done", phase: "done" })]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ runId: "dup", live: true, status: "done", phase: "done" });
  });

  it("sorts active runs above a more-recent terminal run", () => {
    const rows = mergeFeed(
      // A done run updated just now...
      [serverRun({ id: "done", status: "done", updatedAt: "2026-02-01T00:00:00.000Z" })],
      // ...still ranks below a live, in-flight run.
      [liveRun({ runId: "active", status: "thinking", startedAt: 1 })]
    );
    expect(rows.map((r) => r.runId)).toEqual(["active", "done"]);
  });

  it("carries server display fields when the live item is sparse", () => {
    const rows = mergeFeed(
      [serverRun({ id: "p", clientName: "Globex", title: "Real title" })],
      [liveRun({ runId: "p", clientName: "", title: "", status: "running_tool" })]
    );
    expect(rows[0]).toMatchObject({ clientName: "Globex", title: "Real title", live: true });
  });
});
