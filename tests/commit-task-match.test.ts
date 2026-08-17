import { describe, expect, it } from "vitest";
import {
  filterCommitMatches,
  shouldAutoApply,
  AUTO_APPLY_CONFIDENCE_THRESHOLD,
  MATCH_CONFIDENCE_THRESHOLD,
  type CommitMatchCandidate,
  type TaskMatchInput,
} from "@/lib/tasks/commit-match-filter";

// The deterministic net under the model. Every rule here is something the prompt
// already asks for — these tests cover the case where it didn't comply.

const commit = (
  sha: string,
  committedAt: string | null = "2026-07-20T12:00:00Z"
): CommitMatchCandidate => ({
  sha,
  message: `fix(invoices): correct PDF page breaks (${sha})`,
  committedAt,
});

const task = (
  id: string,
  createdAt = "2026-07-01T00:00:00Z"
): TaskMatchInput => ({
  id,
  title: "Fix invoice PDF page breaks",
  description: null,
  type: "bug",
  tags: ["ui"],
  createdAt,
});

const raw = (
  sha: string,
  taskId: string,
  confidence: number,
  reason = "same defect on the same surface"
) => ({ sha, taskId, confidence, reason });

describe("filterCommitMatches", () => {
  it("keeps a high-confidence match on a commit that postdates the task", () => {
    const commits = [commit("aaa1111")];
    const tasks = [task("t1")];
    const out = filterCommitMatches([raw("aaa1111", "t1", 0.93)], commits, tasks);
    expect(out).toEqual([
      {
        sha: "aaa1111",
        taskId: "t1",
        confidence: 0.93,
        reason: "same defect on the same surface",
      },
    ]);
  });

  it("rejects a commit that landed before the task existed", () => {
    // The task was filed a month AFTER this commit, so the commit cannot have
    // finished it no matter how well the text lines up.
    const commits = [commit("aaa1111", "2026-06-01T00:00:00Z")];
    const tasks = [task("t1", "2026-07-01T00:00:00Z")];
    expect(filterCommitMatches([raw("aaa1111", "t1", 0.99)], commits, tasks)).toEqual([]);
  });

  it("keeps a match when the commit date is unknown (nothing to disprove)", () => {
    const commits = [commit("aaa1111", null)];
    const tasks = [task("t1")];
    expect(filterCommitMatches([raw("aaa1111", "t1", 0.9)], commits, tasks)).toHaveLength(1);
  });

  it("rejects anything below the confidence threshold", () => {
    const commits = [commit("aaa1111")];
    const tasks = [task("t1")];
    const justUnder = MATCH_CONFIDENCE_THRESHOLD - 0.01;
    expect(filterCommitMatches([raw("aaa1111", "t1", justUnder)], commits, tasks)).toEqual([]);
    // The threshold itself is inclusive.
    expect(
      filterCommitMatches([raw("aaa1111", "t1", MATCH_CONFIDENCE_THRESHOLD)], commits, tasks)
    ).toHaveLength(1);
  });

  it("rejects a task id that was never sent (hallucinated)", () => {
    const commits = [commit("aaa1111")];
    const tasks = [task("t1")];
    expect(filterCommitMatches([raw("aaa1111", "nope", 0.99)], commits, tasks)).toEqual([]);
  });

  it("rejects a sha that was never sent (hallucinated)", () => {
    const commits = [commit("aaa1111")];
    const tasks = [task("t1")];
    expect(filterCommitMatches([raw("zzz9999", "t1", 0.99)], commits, tasks)).toEqual([]);
  });

  it("keeps only the strongest task per commit", () => {
    const commits = [commit("aaa1111")];
    const tasks = [task("t1"), task("t2")];
    const out = filterCommitMatches(
      [raw("aaa1111", "t1", 0.82), raw("aaa1111", "t2", 0.95)],
      commits,
      tasks
    );
    expect(out).toHaveLength(1);
    expect(out[0].taskId).toBe("t2");
  });

  it("lets two different commits each match a task", () => {
    const commits = [commit("aaa1111"), commit("bbb2222")];
    const tasks = [task("t1"), task("t2")];
    const out = filterCommitMatches(
      [raw("aaa1111", "t1", 0.9), raw("bbb2222", "t2", 0.88)],
      commits,
      tasks
    );
    expect(out.map((m) => m.taskId).sort()).toEqual(["t1", "t2"]);
  });

  it("returns nothing when the model returned nothing", () => {
    expect(filterCommitMatches([], [commit("aaa1111")], [task("t1")])).toEqual([]);
  });
});

// The second threshold: which surviving matches move the task without asking.
describe("shouldAutoApply", () => {
  it("applies a near-certain match", () => {
    expect(shouldAutoApply({ confidence: 0.98 })).toBe(true);
  });

  it("leaves a merely-strong match for the builder to confirm", () => {
    // Above MATCH_CONFIDENCE_THRESHOLD, so it still gets recorded and painted —
    // it just doesn't get to move anything on its own.
    expect(shouldAutoApply({ confidence: 0.87 })).toBe(false);
  });

  it("treats the auto threshold as inclusive", () => {
    expect(shouldAutoApply({ confidence: AUTO_APPLY_CONFIDENCE_THRESHOLD })).toBe(true);
    expect(shouldAutoApply({ confidence: AUTO_APPLY_CONFIDENCE_THRESHOLD - 0.01 })).toBe(false);
  });

  it("sits above the threshold that records a match at all", () => {
    // If these ever crossed, every recorded match would auto-apply and the
    // confirm card would be dead code.
    expect(AUTO_APPLY_CONFIDENCE_THRESHOLD).toBeGreaterThan(MATCH_CONFIDENCE_THRESHOLD);
  });

  it("never sees anything the filter already dropped", () => {
    const commits = [commit("aaa1111")];
    const tasks = [task("t1")];
    // 0.99 but predating the task: filterCommitMatches kills it, so the auto
    // path is never offered a match the age guard rejected.
    const survivors = filterCommitMatches(
      [raw("aaa1111", "t1", 0.99)],
      [commit("aaa1111", "2026-06-01T00:00:00Z")],
      [task("t1", "2026-07-01T00:00:00Z")]
    );
    expect(survivors.filter(shouldAutoApply)).toEqual([]);
    // Same confidence, sane dates — this one does auto-apply.
    expect(
      filterCommitMatches([raw("aaa1111", "t1", 0.99)], commits, tasks).filter(shouldAutoApply)
    ).toHaveLength(1);
  });
});
