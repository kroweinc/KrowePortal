import { describe, expect, it } from "vitest";
import {
  pickLatestMerge,
  pickMergeHeads,
  sortMerges,
  type MergedPrLike,
} from "@/lib/github/merged-prs";

describe("pickLatestMerge (newest push to main)", () => {
  it("returns the most recently merged PR's sha and head branch", () => {
    const pulls: MergedPrLike[] = [
      {
        merged_at: "2026-07-09T00:00:00Z",
        merge_commit_sha: "sha_new",
        head: { ref: "dev" },
      },
      {
        merged_at: "2026-07-01T00:00:00Z",
        merge_commit_sha: "sha_old",
        head: { ref: "hotfix" },
      },
    ];
    expect(pickLatestMerge(pulls)).toEqual({
      sha: "sha_new",
      headRef: "dev",
      mergedAt: "2026-07-09T00:00:00Z",
    });
  });

  it("maxes on merged_at, not list order — a commented-on old PR floats to the top", () => {
    // GitHub sorts by *update* time, so a comment resurfaces a stale merge.
    const pulls: MergedPrLike[] = [
      {
        merged_at: "2026-07-01T00:00:00Z",
        merge_commit_sha: "sha_old",
        head: { ref: "hotfix" },
      },
      {
        merged_at: "2026-07-09T00:00:00Z",
        merge_commit_sha: "sha_new",
        head: { ref: "dev" },
      },
    ];
    expect(pickLatestMerge(pulls)?.sha).toBe("sha_new");
  });

  it("skips closed-but-not-merged PRs", () => {
    const pulls: MergedPrLike[] = [
      { merged_at: null, merge_commit_sha: null, head: { ref: "abandoned" } },
      {
        merged_at: "2026-07-01T00:00:00Z",
        merge_commit_sha: "sha_merged",
        head: { ref: "dev" },
      },
    ];
    expect(pickLatestMerge(pulls)?.sha).toBe("sha_merged");
  });

  it("returns null when no PR is merged or the list is empty", () => {
    expect(pickLatestMerge([])).toBeNull();
    expect(
      pickLatestMerge([{ merged_at: null, merge_commit_sha: null }])
    ).toBeNull();
    // Defensive: a merged_at with no sha isn't shippable.
    expect(
      pickLatestMerge([
        { merged_at: "2026-07-01T00:00:00Z", merge_commit_sha: null },
      ])
    ).toBeNull();
  });

  it("carries a null head ref rather than an empty label", () => {
    const pulls: MergedPrLike[] = [
      { merged_at: "2026-07-01T00:00:00Z", merge_commit_sha: "sha1" },
      { merged_at: "2026-07-02T00:00:00Z", merge_commit_sha: "sha2", head: { ref: "  " } },
    ];
    expect(pickLatestMerge(pulls)?.headRef).toBeNull();
  });
});

describe("pickMergeHeads (branches to scan for unmarked work)", () => {
  const merges = (pulls: MergedPrLike[]) => sortMerges(pulls);

  it("returns the branches that fed main, newest merge first", () => {
    const pulls: MergedPrLike[] = [
      { merged_at: "2026-07-01T00:00:00Z", merge_commit_sha: "a", head: { ref: "hotfix" } },
      { merged_at: "2026-07-09T00:00:00Z", merge_commit_sha: "b", head: { ref: "dev" } },
    ];
    expect(pickMergeHeads(merges(pulls), 3)).toEqual(["dev", "hotfix"]);
  });

  it("dedupes a branch that merged repeatedly — dev is one branch, not ten", () => {
    const pulls: MergedPrLike[] = [
      { merged_at: "2026-07-09T00:00:00Z", merge_commit_sha: "a", head: { ref: "dev" } },
      { merged_at: "2026-07-08T00:00:00Z", merge_commit_sha: "b", head: { ref: "dev" } },
      { merged_at: "2026-07-07T00:00:00Z", merge_commit_sha: "c", head: { ref: "hotfix" } },
    ];
    expect(pickMergeHeads(merges(pulls), 3)).toEqual(["dev", "hotfix"]);
  });

  it("caps the list so the scan can't fan out into a request per branch", () => {
    const pulls: MergedPrLike[] = ["a", "b", "c", "d"].map((ref, i) => ({
      merged_at: `2026-07-0${4 - i}T00:00:00Z`,
      merge_commit_sha: `sha_${ref}`,
      head: { ref },
    }));
    expect(pickMergeHeads(merges(pulls), 2)).toEqual(["a", "b"]);
  });

  it("skips merges with no head ref rather than emitting a blank branch", () => {
    const pulls: MergedPrLike[] = [
      { merged_at: "2026-07-09T00:00:00Z", merge_commit_sha: "a" },
      { merged_at: "2026-07-08T00:00:00Z", merge_commit_sha: "b", head: { ref: "dev" } },
    ];
    expect(pickMergeHeads(merges(pulls), 3)).toEqual(["dev"]);
  });

  it("is empty when nothing has merged", () => {
    expect(pickMergeHeads(merges([]), 3)).toEqual([]);
  });
});
