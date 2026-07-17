import { describe, expect, it } from "vitest";
import {
  isDefaultBranch,
  groupTasksByBranch,
  groupTasksByStagingGroup,
} from "@/lib/tasks/staging-grouping";
import { isBranchListComplete, type BranchGraph } from "@/lib/github/branches";
import type { Task, StagingGroup } from "@/lib/types";

// Minimal Task factory — only the fields the grouping helpers read.
function task(id: string, extra: Partial<Task> = {}): Task {
  return {
    id,
    engagement_id: "e1",
    branch_name: null,
    staging_group_id: null,
    pushed_to_main: false,
    ...extra,
  } as Task;
}

function group(id: string, name: string): StagingGroup {
  return { id, engagement_id: "e1", name, sort_order: 0, created_at: "" };
}

describe("isDefaultBranch (branch → pushed to main)", () => {
  it("is true only when the branch equals the repo default", () => {
    expect(isDefaultBranch("main", "main")).toBe(true);
    expect(isDefaultBranch("master", "master")).toBe(true);
    expect(isDefaultBranch("feature/x", "main")).toBe(false);
  });

  it("is false when either side is null", () => {
    expect(isDefaultBranch(null, "main")).toBe(false);
    expect(isDefaultBranch("main", null)).toBe(false);
    expect(isDefaultBranch(null, null)).toBe(false);
  });
});

describe("groupTasksByBranch", () => {
  it("buckets by branch, sorts named branches, sinks 'No branch' last", () => {
    const buckets = groupTasksByBranch([
      task("1", { branch_name: "feature/z" }),
      task("2", { branch_name: null }),
      task("3", { branch_name: "feature/a" }),
      task("4", { branch_name: "feature/a" }),
    ]);
    expect(buckets.map((b) => b.label)).toEqual([
      "feature/a",
      "feature/z",
      "No branch",
    ]);
    // Same-branch tasks stay in their incoming order.
    expect(buckets[0].tasks.map((t) => t.id)).toEqual(["3", "4"]);
    // The null bucket exposes branch === null so callers can style it.
    expect(buckets[2].branch).toBeNull();
  });

  it("treats a whitespace-only branch as no branch", () => {
    const buckets = groupTasksByBranch([task("1", { branch_name: "   " })]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].label).toBe("No branch");
  });

  it("seeds empty buckets for live branches with no queued work", () => {
    const buckets = groupTasksByBranch(
      [task("1", { branch_name: "feature/a" })],
      ["feature/a", "feature/b", "feature/c"]
    );
    // feature/a keeps its task; b and c show up empty.
    expect(buckets.map((b) => b.label)).toEqual([
      "feature/a",
      "feature/b",
      "feature/c",
    ]);
    expect(buckets[1].tasks).toHaveLength(0);
    expect(buckets[2].tasks).toHaveLength(0);
  });

  it("sorts branches with queued work above empty ones", () => {
    const buckets = groupTasksByBranch(
      [task("1", { branch_name: "zebra" })],
      ["alpha", "zebra"]
    );
    // 'zebra' has work so it leads despite the alphabetical 'alpha'.
    expect(buckets.map((b) => b.label)).toEqual(["zebra", "alpha"]);
  });

  it("excludes default and already-shown branches from empty seeding", () => {
    const buckets = groupTasksByBranch(
      [task("1", { branch_name: "feature/a" })],
      ["main", "feature/a", "feature/shipped", "feature/new"],
      ["main", "feature/shipped"]
    );
    expect(buckets.map((b) => b.label)).toEqual(["feature/a", "feature/new"]);
  });

  it("ignores empty/whitespace names in the seed list", () => {
    const buckets = groupTasksByBranch([], ["", "   ", "feature/x"]);
    expect(buckets.map((b) => b.label)).toEqual(["feature/x"]);
  });
});

describe("groupTasksByStagingGroup", () => {
  const defs = [group("g1", "Release 1.2"), group("g2", "QA batch")];

  it("includes every group in order — even empty ones", () => {
    const buckets = groupTasksByStagingGroup(
      [task("1", { staging_group_id: "g2" })],
      defs
    );
    expect(buckets.map((b) => b.label)).toEqual(["Release 1.2", "QA batch"]);
    expect(buckets[0].tasks).toHaveLength(0); // empty group still shown
    expect(buckets[1].tasks.map((t) => t.id)).toEqual(["1"]);
  });

  it("appends a 'No group' bucket only when ungrouped tasks exist", () => {
    const withUngrouped = groupTasksByStagingGroup(
      [task("1", { staging_group_id: "g1" }), task("2")],
      defs
    );
    expect(withUngrouped.at(-1)?.label).toBe("No group");
    expect(withUngrouped.at(-1)?.groupId).toBeNull();

    const allGrouped = groupTasksByStagingGroup(
      [task("1", { staging_group_id: "g1" })],
      defs
    );
    expect(allGrouped.some((b) => b.label === "No group")).toBe(false);
  });
});

describe("isBranchListComplete", () => {
  function graph(extra: Partial<BranchGraph> = {}): BranchGraph {
    return {
      root: {
        name: "main",
        tipSha: "",
        tipShaFull: "",
        latestCommit: null,
        children: [],
        parentName: null,
        diverged: false,
      },
      truncated: false,
      pairwise: false,
      degraded: [],
      ...extra,
    };
  }

  it("is complete for a clean full listing", () => {
    expect(isBranchListComplete(graph())).toBe(true);
  });

  it("is incomplete when the listing was truncated", () => {
    expect(isBranchListComplete(graph({ truncated: true }))).toBe(false);
  });

  it("is incomplete when a listing page failed", () => {
    expect(isBranchListComplete(graph({ degraded: ["branches:page-2"] }))).toBe(
      false
    );
  });

  // A repo with zero branches reports degraded:["branches"] — that's complete
  // information (there is nothing to list), not a partial fetch.
  it("is complete for a repo with no branches", () => {
    expect(isBranchListComplete(graph({ degraded: ["branches"] }))).toBe(true);
  });

  // Tip-commit / merge-base failures don't shrink the branch name list.
  it("is complete when only non-listing lookups degraded", () => {
    expect(
      isBranchListComplete(graph({ degraded: ["default-missing", "compare:a...b"] }))
    ).toBe(true);
  });
});
