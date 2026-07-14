import type { Task, StagingGroup } from "@/lib/types";

// A rendered bucket on the staging board. Branch mode carries a branch name
// (for the purpose lookup), staging mode carries a group id (for rename/delete).
export type TaskBucket = {
  key: string;
  label: string;
  branch: string | null;
  groupId: string | null;
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
    tasks: list.filter((t) => t.staging_group_id === g.id),
  }));
  const ungrouped = list.filter((t) => !t.staging_group_id);
  if (ungrouped.length > 0) {
    buckets.push({
      key: NO_BUCKET,
      label: "No group",
      branch: null,
      groupId: null,
      tasks: ungrouped,
    });
  }
  return buckets;
}
