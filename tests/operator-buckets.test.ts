import { describe, expect, it } from "vitest";
import { computeOperatorBuckets } from "@/lib/tasks/operator-buckets";
import { sortWithApprovalPin } from "@/lib/utils";
import type { Task } from "@/lib/types";

const NOW = Date.parse("2026-07-13T00:00:00Z");
const WEEK_AGO = NOW - 7 * 86_400_000;
const RECENT = "2026-07-11T00:00:00Z"; // 2 days ago — inside the window
const OLD = "2026-06-01T00:00:00Z"; // well outside the window

// Minimal Task factory — only the fields computeOperatorBuckets reads.
function task(id: string, extra: Partial<Task> = {}): Task {
  return {
    id,
    engagement_id: "e1",
    status: "todo",
    priority: "medium",
    pinned_at: null,
    approval_sent_at: null,
    approval_approved_at: null,
    pushed_to_main: false,
    completed_at: null,
    updated_at: RECENT,
    staging_group: null,
    ...extra,
  } as Task;
}

const ids = (list: Task[]) => list.map((t) => t.id);

describe("computeOperatorBuckets", () => {
  it("pins non-done pinned tasks and pulls them out of the other buckets", () => {
    const tasks = [
      task("pinned-review", { pinned_at: RECENT, approval_sent_at: RECENT }),
      task("pinned-progress", { pinned_at: RECENT, status: "in_progress" }),
      task("pinned-next", { pinned_at: RECENT, status: "todo" }),
      task("plain-review", { approval_sent_at: RECENT }),
      task("plain-progress", { status: "in_progress" }),
      task("plain-next", { status: "backlog" }),
    ];
    const b = computeOperatorBuckets(tasks, WEEK_AGO);

    expect(ids(b.pinned).sort()).toEqual(["pinned-next", "pinned-progress", "pinned-review"]);
    expect(ids(b.review)).toEqual(["plain-review"]);
    expect(ids(b.progress)).toEqual(["plain-progress"]);
    expect(ids(b.upNext)).toEqual(["plain-next"]);
  });

  it("orders pinned tasks newest-pin first", () => {
    const tasks = [
      task("older", { pinned_at: "2026-07-10T00:00:00Z", status: "todo" }),
      task("newer", { pinned_at: "2026-07-12T00:00:00Z", status: "todo" }),
    ];
    expect(ids(computeOperatorBuckets(tasks, WEEK_AGO).pinned)).toEqual(["newer", "older"]);
  });

  it("does not pin a done task — it belongs to Delivered, not the top", () => {
    const tasks = [task("done-pinned", { pinned_at: RECENT, status: "done" })];
    const b = computeOperatorBuckets(tasks, WEEK_AGO);
    expect(b.pinned).toHaveLength(0);
    expect(ids(b.staged)).toEqual(["done-pinned"]); // done & not pushed → staged
  });

  it("splits Delivered into staged (not pushed) and shipped-this-week (pushed, in window)", () => {
    const tasks = [
      task("staged", { status: "done", pushed_to_main: false, completed_at: RECENT }),
      task("shipped-recent", { status: "done", pushed_to_main: true, completed_at: RECENT }),
      task("shipped-old", { status: "done", pushed_to_main: true, completed_at: OLD }),
      task("active", { status: "in_progress" }),
    ];
    const b = computeOperatorBuckets(tasks, WEEK_AGO);

    expect(ids(b.staged)).toEqual(["staged"]);
    expect(ids(b.doneThisWeek)).toEqual(["shipped-recent"]);
    // A pushed task completed outside the window shows in neither delivered bucket.
    expect(ids(b.staged)).not.toContain("shipped-old");
    expect(ids(b.doneThisWeek)).not.toContain("shipped-old");
  });

  it("falls back to updated_at when completed_at is null for the window check", () => {
    const tasks = [
      task("no-completed-at", {
        status: "done",
        pushed_to_main: true,
        completed_at: null,
        updated_at: RECENT,
      }),
    ];
    expect(ids(computeOperatorBuckets(tasks, WEEK_AGO).doneThisWeek)).toEqual(["no-completed-at"]);
  });

  it("orders delivered buckets newest-completed first", () => {
    const tasks = [
      task("s-older", { status: "done", pushed_to_main: false, completed_at: "2026-07-08T00:00:00Z" }),
      task("s-newer", { status: "done", pushed_to_main: false, completed_at: "2026-07-12T00:00:00Z" }),
    ];
    expect(ids(computeOperatorBuckets(tasks, WEEK_AGO).staged)).toEqual(["s-newer", "s-older"]);
  });
});

describe("sortWithApprovalPin — pin tier", () => {
  function row(id: string, extra: Partial<Task> = {}) {
    return task(id, extra);
  }

  it("lifts a pinned task above an unpinned urgent one", () => {
    const sorted = sortWithApprovalPin([
      row("urgent", { priority: "urgent" }),
      row("pinned-low", { priority: "low", pinned_at: RECENT }),
    ]);
    expect(ids(sorted)).toEqual(["pinned-low", "urgent"]);
  });

  it("lifts a pinned task above an awaiting-approval one", () => {
    const sorted = sortWithApprovalPin([
      row("awaiting", { priority: "high", approval_sent_at: RECENT }),
      row("pinned", { priority: "low", pinned_at: RECENT }),
    ]);
    expect(ids(sorted)).toEqual(["pinned", "awaiting"]);
  });

  it("keeps the approval → priority order among unpinned tasks", () => {
    const sorted = sortWithApprovalPin([
      row("low", { priority: "low" }),
      row("urgent", { priority: "urgent" }),
      row("awaiting", { priority: "low", approval_sent_at: RECENT }),
    ]);
    expect(ids(sorted)).toEqual(["awaiting", "urgent", "low"]);
  });
});
