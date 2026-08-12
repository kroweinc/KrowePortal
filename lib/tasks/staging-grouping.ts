import { WORK_KINDS, type Task, type StagingGroup, type Release, type ReleaseGap, type WorkKind } from "@/lib/types";
import { WORK_KIND_LABELS, isCodeWork } from "@/lib/utils";

// A rendered bucket on the staging board. Branch mode carries a branch name
// (for the purpose lookup), staging mode carries a group id (for rename/delete),
// and the Actions section carries a work kind (for its icon and label).
export type TaskBucket = {
  key: string;
  label: string;
  branch: string | null;
  groupId: string | null;
  workKind: WorkKind | null;
  tasks: Task[];
};

// Sentinel key for the null bucket; a leading space keeps it out of the way of
// any real branch/group name.
export const NO_BUCKET = " none";

/**
 * Whether a chosen branch is the repo's default branch — the single source of
 * truth for "selecting main counts as pushed to main". Used by the branch chip
 * picker and the done dialog so the derivation stays consistent.
 */
export function isDefaultBranch(
  branch: string | null,
  defaultBranch: string | null
): boolean {
  return branch !== null && defaultBranch !== null && branch === defaultBranch;
}

// What the builder has picked in a branch chip picker so far. `picked: false`
// means the chips are still showing their pre-selected default, so a fresher
// list may freely replace it.
export type PickedBranch = { picked: boolean; value: string | null };

/**
 * Which branch stays selected when a freshly fetched branch list replaces the
 * one on screen. Untouched chips just take the new default; a deliberate pick is
 * kept — unless that branch no longer exists on the repo, in which case it's
 * reported as `dropped` so the caller can say so rather than silently filing a
 * deliverable under a branch that was deleted out from under it.
 */
export function reconcileBranch(
  picked: PickedBranch,
  next: { branches: { name: string }[]; defaultBranch: string | null }
): { branch: string | null; dropped: string | null } {
  if (!picked.picked) return { branch: next.defaultBranch, dropped: null };
  // "No branch" is a real choice, not an absent one.
  if (picked.value === null) return { branch: null, dropped: null };
  if (next.branches.some((b) => b.name === picked.value)) {
    return { branch: picked.value, dropped: null };
  }
  return { branch: next.defaultBranch, dropped: picked.value };
}

/**
 * Bucket done tasks by branch, preserving the incoming (completed-desc) order
 * within a bucket. Branches with queued work sort first (alphabetically), then
 * any guaranteed-but-empty branches, then the "No branch" bucket last.
 *
 * `extraBranchNames` seeds empty buckets for live repo branches that carry no
 * task yet, so the board reflects the whole repo — not just completed work.
 * `excludeNames` drops names that shouldn't get an empty bucket (the repo
 * default, or a branch already shown in another section).
 */
export function groupTasksByBranch(
  list: Task[],
  extraBranchNames: Iterable<string> = [],
  excludeNames: Iterable<string> = []
): TaskBucket[] {
  const map = new Map<string, Task[]>();
  for (const t of list) {
    const key = t.branch_name && t.branch_name.trim() ? t.branch_name : NO_BUCKET;
    const bucket = map.get(key);
    if (bucket) bucket.push(t);
    else map.set(key, [t]);
  }

  // Guarantee an empty bucket for each live branch we were told to surface,
  // unless it's excluded or already has tasks.
  const exclude = new Set(excludeNames);
  for (const name of extraBranchNames) {
    if (!name || !name.trim() || exclude.has(name) || map.has(name)) continue;
    map.set(name, []);
  }

  const buckets: TaskBucket[] = Array.from(map.entries()).map(([k, tasks]) => ({
    key: k,
    label: k === NO_BUCKET ? "No branch" : k,
    branch: k === NO_BUCKET ? null : k,
    groupId: null,
    workKind: null,
    tasks,
  }));
  buckets.sort((a, b) => {
    if (a.branch === null) return 1;
    if (b.branch === null) return -1;
    // Branches with queued work rise above empty ones so real work stays on top.
    const aHas = a.tasks.length > 0;
    const bHas = b.tasks.length > 0;
    if (aHas !== bHas) return aHas ? -1 : 1;
    return a.branch.localeCompare(b.branch);
  });
  return buckets;
}

/**
 * One entry on the Shipped timeline. Three kinds:
 *   release — a real push (migration 0084). `release` is the row; `children`
 *             are the folded-in releases when it's a combined one. `tasks` is
 *             what went live in it, which is not the same as what points at it
 *             — see the same-day absorption in groupTasksByRelease.
 *   day     — tasks that carry a ship date but no release, on a day whose push
 *             can't be inferred. Backfilled history mostly: the audit log could
 *             date them but not group them.
 *   unknown — shipped work with no date at all, from before any of this.
 */
export type ReleaseBucket = {
  key: string;
  kind: "release" | "day" | "unknown";
  /** Null means the caller derives one — from the sha, or from the kind. */
  label: string | null;
  /** ISO timestamp; null only on the unknown bucket. */
  shippedAt: string | null;
  release: Release | null;
  children: Release[];
  tasks: Task[];
  /** Proposed tasks for work this push shipped with nothing tracking it (0086).
   *  Always empty on the day/unknown buckets — a gap hangs off a real push. */
  gaps: ReleaseGap[];
};

// Sentinel for the undated bucket; a leading space sorts it away from real
// dates, matching the NO_BUCKET convention above.
export const UNKNOWN_DAY = " unknown";

/** The UTC calendar day an ISO timestamp falls on. UTC rather than local so a
 *  client component and its server render never disagree about which day a
 *  push landed on. */
export function shippedDay(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Assemble the Shipped timeline: real releases first-class, dated-but-ungrouped
 * tasks collapsed into per-day entries, and undated stragglers in one trailing
 * bucket. Newest first throughout.
 *
 * Releases holding no *visible* task are dropped. That covers both the empty
 * auto release kept as an idempotency tombstone after an undo, and any release
 * whose tasks the current filter excludes — neither should render as a push
 * that shipped nothing.
 *
 * The one exception is a push carrying an untracked-work proposal (0086): a
 * push where the builder tracked nothing at all is exactly the case worth
 * surfacing, and dropping it would hide the only thing that can tell them.
 */
export function groupTasksByRelease(
  list: Task[],
  releases: Release[],
  gapsByRelease: Record<string, ReleaseGap[]> = {}
): ReleaseBucket[] {
  const tasksByRelease = new Map<string, Task[]>();
  for (const t of list) {
    if (!t.release_id) continue;
    const bucket = tasksByRelease.get(t.release_id);
    if (bucket) bucket.push(t);
    else tasksByRelease.set(t.release_id, [t]);
  }

  // Incoming position, so a combined release's tasks keep the caller's
  // completed-desc order instead of clustering by which child they came from —
  // the same within-bucket guarantee groupTasksByBranch makes.
  const order = new Map(list.map((t, i) => [t.id, i]));

  const byId = new Map(releases.map((r) => [r.id, r]));
  const childrenByParent = new Map<string, Release[]>();
  for (const r of releases) {
    if (!r.combined_into_id) continue;
    const bucket = childrenByParent.get(r.combined_into_id);
    if (bucket) bucket.push(r);
    else childrenByParent.set(r.combined_into_id, [r]);
  }

  const buckets: ReleaseBucket[] = [];
  const claimed = new Set<string>();

  for (const release of releases) {
    if (release.combined_into_id) continue; // rendered under its parent
    const children = (childrenByParent.get(release.id) ?? [])
      .slice()
      .sort((a, b) => (a.shipped_at < b.shipped_at ? 1 : -1));
    const tasks = [
      ...(tasksByRelease.get(release.id) ?? []),
      ...children.flatMap((c) => tasksByRelease.get(c.id) ?? []),
    ].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    // Gaps roll up from the children the same way tasks do, so a combined
    // release shows every proposal folded into it.
    const gaps = [
      ...(gapsByRelease[release.id] ?? []),
      ...children.flatMap((c) => gapsByRelease[c.id] ?? []),
    ];
    if (tasks.length === 0 && gaps.length === 0) continue;

    for (const t of tasks) claimed.add(t.id);
    buckets.push({
      key: release.id,
      kind: "release",
      // A builder's name wins; then the merge commit's subject, which says what
      // the push actually was; then the branch, which only a merge commit sets.
      label: release.title ?? release.merge_subject ?? release.branch_name,
      shippedAt: release.shipped_at,
      release,
      children,
      tasks,
      gaps,
    });
  }

  // Everything a release didn't claim — including tasks pointing at a release
  // that isn't in scope — falls back to its ship date.
  const byDay = new Map<string, Task[]>();
  for (const t of list) {
    if (claimed.has(t.id)) continue;
    if (t.release_id && byId.has(t.release_id)) continue;
    const key = t.shipped_at ? shippedDay(t.shipped_at) : UNKNOWN_DAY;
    const bucket = byDay.get(key);
    if (bucket) bucket.push(t);
    else byDay.set(key, [t]);
  }

  // A day that saw exactly one push is unambiguous: work dated to it went out
  // in that push, whether or not anything recorded the link. Standing it beside
  // the push as a separate "no push recorded" row splits one release in two and
  // states something false about a day that plainly had a push. Days with two or
  // more pushes stay split — picking one of them would be inventing history.
  const releasesByDay = new Map<string, ReleaseBucket[]>();
  for (const b of buckets) {
    if (!b.shippedAt) continue;
    const key = shippedDay(b.shippedAt);
    const sameDay = releasesByDay.get(key);
    if (sameDay) sameDay.push(b);
    else releasesByDay.set(key, [b]);
  }

  for (const [day, tasks] of byDay) {
    const unknown = day === UNKNOWN_DAY;
    const sameDay = unknown ? [] : (releasesByDay.get(day) ?? []);
    if (sameDay.length === 1) {
      const host = sameDay[0];
      host.tasks = [...host.tasks, ...tasks].sort(
        (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)
      );
      continue;
    }
    buckets.push({
      key: `day:${day}`,
      kind: unknown ? "unknown" : "day",
      label: unknown ? "Earlier · date unknown" : null,
      // Midday UTC so formatting the day back out can't slip a date either way.
      shippedAt: unknown ? null : `${day}T12:00:00.000Z`,
      release: null,
      children: [],
      tasks,
      gaps: [],
    });
  }

  buckets.sort((a, b) => {
    if (a.shippedAt === null) return 1;
    if (b.shippedAt === null) return -1;
    return a.shippedAt < b.shippedAt ? 1 : a.shippedAt > b.shippedAt ? -1 : 0;
  });
  return buckets;
}

/** A calendar day on the Shipped timeline, holding every push that landed on
 *  it. Several pushes a day is normal, and read as a flat list they were
 *  indistinguishable — each one showing the same date and nothing else. */
export type ReleaseDay = {
  /** The UTC day ("2026-07-30"), or UNKNOWN_DAY for the undated tail. */
  key: string;
  /** ISO timestamp to format the header from; null on the undated group. */
  shippedAt: string | null;
  pushes: ReleaseBucket[];
  /** Tasks across every push that day — the header's headline number. */
  taskCount: number;
  /** Untracked-work proposals across the day, so a collapsed day still says
   *  there is something to look at inside it. */
  gapCount: number;
};

/**
 * Fold a release timeline into per-day sections.
 *
 * Order is inherited, never recomputed: `groupTasksByRelease` already returns
 * newest-first, so walking it in order yields newest-first days whose pushes are
 * newest-first within each. Re-sorting here would be a second, divergent
 * definition of "newest".
 */
export function groupReleasesByDay(buckets: ReleaseBucket[]): ReleaseDay[] {
  const days: ReleaseDay[] = [];
  const byKey = new Map<string, ReleaseDay>();

  for (const bucket of buckets) {
    const key = bucket.shippedAt ? shippedDay(bucket.shippedAt) : UNKNOWN_DAY;
    let day = byKey.get(key);
    if (!day) {
      day = { key, shippedAt: bucket.shippedAt, pushes: [], taskCount: 0, gapCount: 0 };
      byKey.set(key, day);
      days.push(day);
    }
    day.pushes.push(bucket);
    day.taskCount += bucket.tasks.length;
    day.gapCount += bucket.gaps.length;
  }

  return days;
}

/**
 * Bucket done tasks by staging group. Every provided group is included — even
 * empty ones — in the given order, so freshly created groups are visible and
 * manageable before any task lands in them. A trailing "No group" bucket is
 * added only when there are ungrouped tasks.
 */
export function groupTasksByStagingGroup(
  list: Task[],
  groupDefs: StagingGroup[]
): TaskBucket[] {
  const buckets: TaskBucket[] = groupDefs.map((g) => ({
    key: g.id,
    label: g.name,
    branch: null,
    groupId: g.id,
    workKind: null,
    tasks: list.filter((t) => t.staging_group_id === g.id),
  }));
  const ungrouped = list.filter((t) => !t.staging_group_id);
  if (ungrouped.length > 0) {
    buckets.push({
      key: NO_BUCKET,
      label: "No group",
      branch: null,
      groupId: null,
      workKind: null,
      tasks: ungrouped,
    });
  }
  return buckets;
}

/**
 * Split done work into the half the branch grouping is about and the half it
 * isn't (migration 0089).
 *
 * Sending an email or asking the client a question is finished work with no
 * branch, no commit and nothing to push — but it still came out of the same
 * done pipeline, so it landed in the branch view's "No branch" bucket and sat
 * in "Next push" forever, queued behind a push that was never coming. The kind
 * the builder chose at approval decides this, not the presence of a branch:
 * "No branch" still means a code task whose branch nobody recorded.
 */
export function splitCodeWork(list: Task[]): { code: Task[]; actions: Task[] } {
  const code: Task[] = [];
  const actions: Task[] = [];
  for (const t of list) (isCodeWork(t) ? code : actions).push(t);
  return { code, actions };
}

/**
 * What the staging board is *about*: finished code sitting on a branch that
 * hasn't reached main yet.
 *
 * Non-code work is lifted out first — it answers to neither a branch nor a
 * push — and anything already pushed belongs on the Shipped timeline, not in a
 * queue. Both group-by modes read the queue through this one function, so the
 * Branch tab and the Staging tab can't drift on what "waiting" means.
 */
export function queuedCodeWork(list: Task[]): Task[] {
  return splitCodeWork(list).code.filter((t) => !t.pushed_to_main);
}

/**
 * Bucket non-code work by its kind, in the fixed WORK_KINDS order so the
 * section doesn't reshuffle as tasks land. Incoming (completed-desc) order is
 * preserved within a bucket, and empty kinds are dropped — unlike a branch,
 * a kind with nothing in it is not a thing waiting to be filled.
 *
 * Pass only what `splitCodeWork` returned as `actions`; a code task here would
 * silently vanish, since "code" gets no bucket.
 */
export function groupTasksByWorkKind(list: Task[]): TaskBucket[] {
  return WORK_KINDS.filter((kind) => kind !== "code")
    .map((kind) => ({
      key: `kind:${kind}`,
      label: WORK_KIND_LABELS[kind],
      branch: null,
      groupId: null,
      workKind: kind,
      tasks: list.filter((t) => t.work_kind === kind),
    }))
    .filter((b) => b.tasks.length > 0);
}
