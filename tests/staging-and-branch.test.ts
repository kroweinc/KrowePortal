import { describe, expect, it } from "vitest";
import {
  isDefaultBranch,
  groupTasksByBranch,
  groupTasksByStagingGroup,
  groupTasksByRelease,
  groupReleasesByDay,
  reconcileBranch,
} from "@/lib/tasks/staging-grouping";
import { isListingComplete } from "@/lib/github/branches";
import type { Task, StagingGroup, Release, ReleaseGap } from "@/lib/types";

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

function release(id: string, extra: Partial<Release> = {}): Release {
  return {
    id,
    engagement_id: "e1",
    kind: "auto",
    title: null,
    notes: null,
    repo_full_name: "acme/app",
    branch_name: null,
    merge_sha: null,
    merge_subject: null,
    shipped_at: "2026-07-10T12:00:00.000Z",
    combined_into_id: null,
    created_at: "",
    ...extra,
  };
}

function gap(id: string, releaseId: string): ReleaseGap {
  return {
    id,
    release_id: releaseId,
    engagement_id: "e1",
    repo_full_name: "acme/app",
    title: "Add PDF export to the agent report",
    description: "Renders the agent report as a downloadable PDF.",
    priority: "medium",
    type: "feature",
    tags: [],
    confidence: "high",
    evidence: [],
    files: [],
    created_at: "",
  };
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

describe("groupReleasesByDay (Shipped timeline, day-grouped)", () => {
  it("folds same-day pushes under one day and keeps them newest-first", () => {
    const buckets = groupTasksByRelease(
      [
        task("1", { release_id: "evening", pushed_to_main: true }),
        task("2", { release_id: "morning", pushed_to_main: true }),
        task("3", { release_id: "morning", pushed_to_main: true }),
        task("4", { release_id: "earlier-day", pushed_to_main: true }),
      ],
      [
        release("evening", {
          merge_sha: "aca974b",
          merge_subject: "fix(email): stop copying the firm inbox",
          shipped_at: "2026-07-30T17:07:48.000Z",
        }),
        release("morning", {
          merge_sha: "f5af717",
          merge_subject: "Merge branch 'AgentPDF' into dev",
          branch_name: "AgentPDF",
          shipped_at: "2026-07-30T04:19:35.000Z",
        }),
        release("earlier-day", {
          merge_sha: "3b999e5",
          merge_subject: "feat(call-sheet): agent-facing call sheet",
          shipped_at: "2026-07-28T09:00:00.000Z",
        }),
      ]
    );

    const days = groupReleasesByDay(buckets);
    expect(days.map((d) => d.key)).toEqual(["2026-07-30", "2026-07-28"]);
    // Two pushes on the 30th, in the order the timeline already sorted them.
    expect(days[0].pushes.map((p) => p.key)).toEqual(["evening", "morning"]);
    expect(days[0].taskCount).toBe(3);
    expect(days[1].pushes).toHaveLength(1);
    expect(days[1].taskCount).toBe(1);
  });

  it("labels a push by its merge subject before its branch", () => {
    const [bucket] = groupTasksByRelease(
      [task("1", { release_id: "r", pushed_to_main: true })],
      [
        release("r", {
          branch_name: "AgentPDF",
          merge_subject: "Merge branch 'AgentPDF' into dev",
        }),
      ]
    );
    expect(bucket.label).toBe("Merge branch 'AgentPDF' into dev");
  });

  it("still prefers a builder's name over the merge subject", () => {
    const [bucket] = groupTasksByRelease(
      [task("1", { release_id: "r", pushed_to_main: true })],
      [
        release("r", {
          title: "Security pass",
          branch_name: "hardening",
          merge_subject: "Merge branch 'hardening' into dev",
        }),
      ]
    );
    expect(bucket.label).toBe("Security pass");
  });

  it("keeps the undated tail as its own trailing day", () => {
    const buckets = groupTasksByRelease(
      [
        task("1", { pushed_to_main: true, shipped_at: "2026-07-30T04:00:00.000Z" }),
        task("2", { pushed_to_main: true, shipped_at: null }),
      ],
      []
    );
    const days = groupReleasesByDay(buckets);
    expect(days.map((d) => d.key)).toEqual(["2026-07-30", " unknown"]);
    expect(days[1].shippedAt).toBeNull();
  });

  it("absorbs dated-but-ungrouped work into the day's only push", () => {
    const buckets = groupTasksByRelease(
      [
        task("1", { release_id: "r", pushed_to_main: true }),
        // No release, but dated — the backfill could date it, not group it.
        task("2", { pushed_to_main: true, shipped_at: "2026-07-30T21:00:00.000Z" }),
      ],
      [release("r", { merge_sha: "aca974b", shipped_at: "2026-07-30T04:00:00.000Z" })]
    );
    const days = groupReleasesByDay(buckets);
    expect(days).toHaveLength(1);
    // One row, not a push beside a "no push recorded" twin.
    expect(days[0].pushes.map((p) => p.kind)).toEqual(["release"]);
    expect(days[0].pushes[0].tasks.map((t) => t.id)).toEqual(["1", "2"]);
    expect(days[0].taskCount).toBe(2);
  });

  it("keeps ungrouped work separate when the day had two pushes to choose from", () => {
    const buckets = groupTasksByRelease(
      [
        task("1", { release_id: "a", pushed_to_main: true }),
        task("2", { release_id: "b", pushed_to_main: true }),
        task("3", { pushed_to_main: true, shipped_at: "2026-07-11T21:00:00.000Z" }),
      ],
      [
        release("a", { merge_sha: "a84edbe", shipped_at: "2026-07-11T16:18:00.000Z" }),
        release("b", { merge_sha: "6f90b90", shipped_at: "2026-07-11T07:02:00.000Z" }),
      ]
    );
    const days = groupReleasesByDay(buckets);
    expect(days).toHaveLength(1);
    // Attributing task 3 to either push would be a guess, so it stays its own row.
    expect(days[0].pushes.filter((p) => p.kind === "day")).toHaveLength(1);
    expect(days[0].taskCount).toBe(3);
  });

  it("absorbed work keeps the caller's completed-desc order, not push-then-rest", () => {
    const buckets = groupTasksByRelease(
      [
        task("newest", { pushed_to_main: true, shipped_at: "2026-07-30T21:00:00.000Z" }),
        task("middle", { release_id: "r", pushed_to_main: true }),
        task("oldest", { pushed_to_main: true, shipped_at: "2026-07-30T21:00:00.000Z" }),
      ],
      [release("r", { merge_sha: "aca974b", shipped_at: "2026-07-30T04:00:00.000Z" })]
    );
    expect(buckets[0].tasks.map((t) => t.id)).toEqual(["newest", "middle", "oldest"]);
  });

  it("never absorbs the undated tail into a push", () => {
    const buckets = groupTasksByRelease(
      [
        task("1", { release_id: "r", pushed_to_main: true }),
        task("2", { pushed_to_main: true, shipped_at: null }),
      ],
      [release("r", { merge_sha: "aca974b", shipped_at: "2026-07-30T04:00:00.000Z" })]
    );
    expect(buckets.map((b) => b.kind)).toEqual(["release", "unknown"]);
    expect(buckets[0].tasks.map((t) => t.id)).toEqual(["1"]);
  });

  it("is empty for an empty timeline", () => {
    expect(groupReleasesByDay([])).toEqual([]);
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

// Gates the cache sweep: only a listing known to be the repo's *whole* branch
// list may be used to delete rows, or a truncated page would wipe live branches.
describe("isListingComplete", () => {
  it("is complete for a clean full listing", () => {
    expect(isListingComplete(false, [])).toBe(true);
  });

  it("is incomplete when the listing was truncated", () => {
    expect(isListingComplete(true, [])).toBe(false);
  });

  it("is incomplete when a listing page failed", () => {
    expect(isListingComplete(false, ["branches:page-2"])).toBe(false);
  });

  // A repo with zero branches reports degraded:["branches"] — that's complete
  // information (there is nothing to list), not a partial fetch.
  it("is complete for a repo with no branches", () => {
    expect(isListingComplete(false, ["branches"])).toBe(true);
  });

  // Tip-commit / merge-base failures don't shrink the branch name list.
  it("is complete when only non-listing lookups degraded", () => {
    expect(isListingComplete(false, ["default-missing", "compare:a...b"])).toBe(true);
  });
});

// The branch pickers paint a server-preloaded list, then reconcile against a
// freshly pulled one. These cases decide what a deliverable gets filed under
// when a branch was deleted on GitHub in between.
describe("reconcileBranch", () => {
  const live = {
    branches: [{ name: "main" }, { name: "email" }],
    defaultBranch: "main",
  };

  it("takes the fresh default while the chips are untouched", () => {
    expect(reconcileBranch({ picked: false, value: null }, live)).toEqual({
      branch: "main",
      dropped: null,
    });
    // Even if a stale render had pre-selected something else.
    expect(reconcileBranch({ picked: false, value: "old-default" }, live)).toEqual({
      branch: "main",
      dropped: null,
    });
  });

  it("keeps a deliberate pick that still exists", () => {
    expect(reconcileBranch({ picked: true, value: "email" }, live)).toEqual({
      branch: "email",
      dropped: null,
    });
  });

  it("keeps an explicit 'No branch'", () => {
    expect(reconcileBranch({ picked: true, value: null }, live)).toEqual({
      branch: null,
      dropped: null,
    });
  });

  // The bug this guards: a branch deleted on GitHub was still clickable from a
  // stale snapshot, so the deliverable got filed under a branch that was gone.
  it("drops a pick whose branch no longer exists, and reports it", () => {
    expect(reconcileBranch({ picked: true, value: "deleted-branch" }, live)).toEqual({
      branch: "main",
      dropped: "deleted-branch",
    });
  });

  it("falls back to no branch when the repo has no default", () => {
    expect(
      reconcileBranch(
        { picked: true, value: "deleted-branch" },
        { branches: [{ name: "email" }], defaultBranch: null }
      )
    ).toEqual({ branch: null, dropped: "deleted-branch" });
  });
});

describe("groupTasksByRelease (the Shipped timeline)", () => {
  it("groups tasks under their release and labels it from the title", () => {
    const buckets = groupTasksByRelease(
      [
        task("1", { release_id: "r1", shipped_at: "2026-07-10T12:00:00.000Z" }),
        task("2", { release_id: "r1", shipped_at: "2026-07-10T12:00:00.000Z" }),
      ],
      [release("r1", { title: "Security pass", branch_name: "hardening" })]
    );
    expect(buckets).toHaveLength(1);
    expect(buckets[0].kind).toBe("release");
    expect(buckets[0].label).toBe("Security pass");
    expect(buckets[0].tasks.map((t) => t.id)).toEqual(["1", "2"]);
  });

  it("falls back to the branch name when a release has no title", () => {
    const buckets = groupTasksByRelease(
      [task("1", { release_id: "r1", shipped_at: "2026-07-10T12:00:00.000Z" })],
      [release("r1", { branch_name: "dev" })]
    );
    expect(buckets[0].label).toBe("dev");
  });

  it("collapses dated-but-ungrouped tasks into one bucket per UTC day", () => {
    const buckets = groupTasksByRelease(
      [
        task("1", { shipped_at: "2026-07-10T09:00:00.000Z" }),
        task("2", { shipped_at: "2026-07-10T23:30:00.000Z" }),
        task("3", { shipped_at: "2026-07-11T01:00:00.000Z" }),
      ],
      []
    );
    expect(buckets.map((b) => b.kind)).toEqual(["day", "day"]);
    // Newest day first; the two Jul-10 tasks share a bucket.
    expect(buckets[0].tasks.map((t) => t.id)).toEqual(["3"]);
    expect(buckets[1].tasks.map((t) => t.id)).toEqual(["1", "2"]);
    // A day bucket has no release row and derives its own label.
    expect(buckets[0].release).toBeNull();
    expect(buckets[0].label).toBeNull();
  });

  it("sinks undated shipped work into a single trailing bucket", () => {
    const buckets = groupTasksByRelease(
      [
        task("1", { shipped_at: null }),
        task("2", { shipped_at: "2026-07-10T09:00:00.000Z" }),
        task("3", { shipped_at: null }),
      ],
      []
    );
    expect(buckets.map((b) => b.kind)).toEqual(["day", "unknown"]);
    const last = buckets[buckets.length - 1];
    expect(last.shippedAt).toBeNull();
    expect(last.tasks.map((t) => t.id)).toEqual(["1", "3"]);
  });

  it("rolls a combined release's children up into the parent", () => {
    const buckets = groupTasksByRelease(
      [
        task("1", { release_id: "child-a" }),
        task("2", { release_id: "child-b" }),
      ],
      [
        release("parent", {
          kind: "combined",
          title: "Security + staging UI",
          merge_sha: null,
          repo_full_name: null,
          shipped_at: "2026-07-28T12:00:00.000Z",
        }),
        release("child-a", {
          branch_name: "hardening",
          combined_into_id: "parent",
          shipped_at: "2026-07-27T12:00:00.000Z",
        }),
        release("child-b", {
          branch_name: "staging-ui",
          combined_into_id: "parent",
          shipped_at: "2026-07-28T12:00:00.000Z",
        }),
      ]
    );
    // One entry: the parent. Children never render at the top level.
    expect(buckets).toHaveLength(1);
    expect(buckets[0].label).toBe("Security + staging UI");
    expect(buckets[0].tasks.map((t) => t.id)).toEqual(["1", "2"]);
    // Children are listed newest-first under it.
    expect(buckets[0].children.map((c) => c.branch_name)).toEqual([
      "staging-ui",
      "hardening",
    ]);
  });

  it("drops an emptied release rather than rendering a push that shipped nothing", () => {
    // The tombstone an undo leaves behind: the row survives so the merge poll
    // won't re-ship it, but it has no tasks and must not reach the timeline.
    const buckets = groupTasksByRelease([], [release("r1", { branch_name: "dev" })]);
    expect(buckets).toEqual([]);
  });

  it("keeps a task-less release that carries an untracked-work proposal", () => {
    // A push where the builder tracked nothing at all is exactly the case the
    // gap scan exists for — dropping it would hide the only thing that can
    // tell them. The tombstone rule above still holds when there are no gaps.
    const buckets = groupTasksByRelease([], [release("r1", { branch_name: "dev" })], {
      r1: [gap("g1", "r1")],
    });
    expect(buckets).toHaveLength(1);
    expect(buckets[0].tasks).toEqual([]);
    expect(buckets[0].gaps.map((g) => g.id)).toEqual(["g1"]);
    expect(buckets[0].label).toBe("dev");
  });

  it("gives every other bucket an empty gaps array", () => {
    const buckets = groupTasksByRelease(
      [
        task("1", { release_id: "r1", shipped_at: "2026-07-10T12:00:00.000Z" }),
        task("2", { shipped_at: "2026-07-11T09:00:00.000Z" }),
        task("3", { shipped_at: null }),
      ],
      [release("r1")]
    );
    expect(buckets.map((b) => b.gaps)).toEqual([[], [], []]);
  });

  it("rolls a combined release's gaps up into the parent, like its tasks", () => {
    const buckets = groupTasksByRelease(
      [task("1", { release_id: "child-a" })],
      [
        release("parent", { kind: "combined", title: "July batch" }),
        // Distinct ship dates: children render newest-push-first, and their gaps
        // inherit that order rather than the order the rows came back in.
        release("child-a", {
          combined_into_id: "parent",
          shipped_at: "2026-07-11T12:00:00.000Z",
        }),
        release("child-b", {
          combined_into_id: "parent",
          shipped_at: "2026-07-09T12:00:00.000Z",
        }),
      ],
      { "child-a": [gap("g1", "child-a")], "child-b": [gap("g2", "child-b")] }
    );
    expect(buckets).toHaveLength(1);
    expect(buckets[0].gaps.map((g) => g.id)).toEqual(["g1", "g2"]);
  });

  it("day-groups a task whose release is out of the current filter's scope", () => {
    const buckets = groupTasksByRelease(
      [task("1", { release_id: "other-client", shipped_at: "2026-07-10T09:00:00.000Z" })],
      []
    );
    expect(buckets).toHaveLength(1);
    expect(buckets[0].kind).toBe("day");
    expect(buckets[0].tasks.map((t) => t.id)).toEqual(["1"]);
  });

  it("orders releases and day buckets together, newest first", () => {
    const buckets = groupTasksByRelease(
      [
        task("old", { release_id: "r1" }),
        task("mid", { shipped_at: "2026-07-15T09:00:00.000Z" }),
        task("new", { release_id: "r2" }),
      ],
      [
        release("r1", { branch_name: "a", shipped_at: "2026-07-01T12:00:00.000Z" }),
        release("r2", { branch_name: "b", shipped_at: "2026-07-28T12:00:00.000Z" }),
      ]
    );
    expect(buckets.flatMap((b) => b.tasks.map((t) => t.id))).toEqual([
      "new",
      "mid",
      "old",
    ]);
  });
});
