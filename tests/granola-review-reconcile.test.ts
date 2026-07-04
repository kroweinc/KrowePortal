import { describe, expect, it } from "vitest";
import { reconcileDraftRows } from "@/components/granola/review-reconcile";
import type { ExtractedTaskDraft } from "@/lib/ai/schemas";

function draft(title: string, owner?: string): ExtractedTaskDraft {
  return {
    title,
    description: `Do the thing described by "${title}" end to end.`,
    priority: "medium",
    type: "change",
    tags: [],
    owner,
    checklist: [],
    dependencies: [],
    confidence: "medium",
  };
}

interface TestRow {
  title: string;
  owner?: string;
  edited: boolean;
}

const toRow = (d: ExtractedTaskDraft): TestRow => ({
  title: d.title,
  owner: d.owner,
  edited: false,
});

describe("reconcileDraftRows", () => {
  it("appends only the tail on mid-stream growth, preserving earlier rows and their edits", () => {
    const rows: TestRow[] = [{ title: "A (renamed by builder)", owner: undefined, edited: true }];
    const drafts = [draft("A"), draft("B")];

    const next = reconcileDraftRows(rows, drafts, true, true, toRow);

    expect(next).toHaveLength(2);
    expect(next![0]).toBe(rows[0]); // same object — edit untouched
    expect(next![1]).toEqual({ title: "B", owner: undefined, edited: false });
  });

  it("keeps rows when nothing changed mid-stream", () => {
    const rows = [draft("A")].map(toRow);
    expect(reconcileDraftRows(rows, [draft("A")], true, true, toRow)).toBeNull();
  });

  it("rebuilds wholesale on stream end even when the length is unchanged", () => {
    // The `done` payload is the finalizeExtraction output — repairs (owner
    // reattribution, appended checklist entries) can leave the count intact.
    const rows = [draft("A"), draft("B")].map(toRow);
    const finalized = [draft("A", "Rahul"), draft("B")];

    const next = reconcileDraftRows(rows, finalized, false, true, toRow);

    expect(next).not.toBeNull();
    expect(next![0].owner).toBe("Rahul");
  });

  it("rebuilds on stream end when the finalized set shrank", () => {
    const rows = [draft("A"), draft("B"), draft("C")].map(toRow);
    const next = reconcileDraftRows(rows, [draft("AB merged")], false, true, toRow);
    expect(next).toEqual([{ title: "AB merged", owner: undefined, edited: false }]);
  });

  it("rebuilds when a new stream starts over existing rows", () => {
    const rows = [draft("stale")].map(toRow);
    const next = reconcileDraftRows(rows, [draft("fresh")], true, false, toRow);
    expect(next).toEqual([{ title: "fresh", owner: undefined, edited: false }]);
  });

  it("leaves the non-streaming (blocking fallback) path unchanged", () => {
    // Drafts arrive once; streaming is constantly false.
    const rows = [draft("A")].map(toRow);
    expect(reconcileDraftRows(rows, [draft("A")], false, false, toRow)).toBeNull();

    // Length-based behavior is retained for completeness.
    const grown = reconcileDraftRows(rows, [draft("A"), draft("B")], false, false, toRow);
    expect(grown).toHaveLength(2);
    expect(grown![0]).toBe(rows[0]);
  });
});
