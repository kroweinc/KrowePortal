import { describe, expect, it } from "vitest";
import {
  pickMergedSha,
  isNewMerge,
  type MergedPrLike,
} from "@/lib/github/merged-prs";

describe("pickMergedSha (branch merged into main → merge sha)", () => {
  it("returns the first merged PR's merge_commit_sha (list is newest-first)", () => {
    const pulls: MergedPrLike[] = [
      { merged_at: "2026-07-09T00:00:00Z", merge_commit_sha: "sha_new" },
      { merged_at: "2026-07-01T00:00:00Z", merge_commit_sha: "sha_old" },
    ];
    expect(pickMergedSha(pulls)).toBe("sha_new");
  });

  it("skips closed-but-not-merged PRs and returns the first actually-merged one", () => {
    const pulls: MergedPrLike[] = [
      { merged_at: null, merge_commit_sha: null }, // closed without merge
      { merged_at: "2026-07-01T00:00:00Z", merge_commit_sha: "sha_merged" },
    ];
    expect(pickMergedSha(pulls)).toBe("sha_merged");
  });

  it("returns null when no PR is merged or the list is empty", () => {
    expect(pickMergedSha([])).toBeNull();
    expect(
      pickMergedSha([{ merged_at: null, merge_commit_sha: null }])
    ).toBeNull();
    // Defensive: a merged_at with no sha isn't shippable.
    expect(
      pickMergedSha([{ merged_at: "2026-07-01T00:00:00Z", merge_commit_sha: null }])
    ).toBeNull();
  });
});

describe("isNewMerge (poll idempotency + undo-safety)", () => {
  it("ships a merge the first time (no recorded mark)", () => {
    expect(isNewMerge(undefined, "sha1")).toBe(true);
    expect(isNewMerge(null, "sha1")).toBe(true);
  });

  it("does not re-ship the same recorded merge (idempotent + undo stays undone)", () => {
    expect(isNewMerge("sha1", "sha1")).toBe(false);
  });

  it("ships again once a newer merge lands on the branch", () => {
    expect(isNewMerge("sha1", "sha2")).toBe(true);
  });

  it("never ships when there is no merge sha", () => {
    expect(isNewMerge(null, null)).toBe(false);
    expect(isNewMerge("sha1", null)).toBe(false);
  });
});
