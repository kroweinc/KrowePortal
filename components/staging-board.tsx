"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { GitBranch, Layers, Plus, Pencil, Trash2, Check, X, Rocket, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { TaskCard } from "@/components/task-card";
import { TaskDetailSheet } from "@/components/task-detail-sheet";
import {
  createStagingGroup,
  renameStagingGroup,
  deleteStagingGroup,
} from "@/lib/actions/staging-groups";
import { setTasksPushedToMain, pollBranchMerges } from "@/lib/actions/tasks";
import type { PreloadedBranches } from "@/lib/actions/get-engagement-branches";
import {
  groupTasksByBranch,
  groupTasksByStagingGroup,
  type TaskBucket,
} from "@/lib/tasks/staging-grouping";
import type { Task, Engagement, StagingGroup } from "@/lib/types";

interface StagingBoardProps {
  tasks: Task[];
  engagements: Engagement[];
  // branch name → AI "purpose" one-liner, used as the branch group subtitle.
  purposes: Record<string, string>;
  currentUserId: string;
  // All staging groups across the builder's engagements.
  stagingGroups: StagingGroup[];
  // Cached repo branches keyed by engagement id, for the detail sheet chips.
  branchesByEngagement: Record<string, PreloadedBranches>;
}

type GroupMode = "branch" | "staging";

function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function StagingBoard({
  tasks,
  engagements,
  purposes,
  currentUserId,
  stagingGroups,
  branchesByEngagement,
}: StagingBoardProps) {
  const engagementMap = new Map(engagements.map((e) => [e.id, e.title]));
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("task"));

  // Group management UI state.
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // PR-merge auto-detect: on mount and whenever "Check for pushes" bumps the
  // tick, ask the server which staged branches were merged into main and move
  // their tasks to Shipped, toasting (with Undo) for each.
  const [pollTick, setPollTick] = useState(0);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const ids = engagements.map((e) => e.id);
    // Nothing to detect unless some done task is queued for the next push on a
    // real branch — skip the GitHub/DB round-trips otherwise.
    const hasStaged = tasks.some((t) => !t.pushed_to_main && t.branch_name);
    if (ids.length === 0 || !hasStaged) return;
    let cancelled = false;
    setChecking(true);
    pollBranchMerges(ids)
      .then((results) => {
        if (cancelled) return;
        for (const r of results) {
          toast.success(`Moved ${plural(r.taskIds.length, "task")} on ${r.branch} to Shipped`, {
            action: {
              label: "Undo",
              onClick: () =>
                setTasksPushedToMain(r.taskIds, false).then(() => router.refresh()),
            },
          });
        }
        if (results.length > 0) router.refresh();
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
    // Re-runs only when the user hits "Check for pushes"; engagements/router are
    // stable for the life of the board.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollTick]);

  function shipBranch(g: TaskBucket) {
    const ids = g.tasks.map((t) => t.id);
    const label = g.label;
    startTransition(async () => {
      const res = await setTasksPushedToMain(ids, true);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(`Moved ${plural(res.movedIds.length, "task")} on ${label} to Shipped`, {
        action: {
          label: "Undo",
          onClick: () =>
            startTransition(async () => {
              await setTasksPushedToMain(res.movedIds, false);
              router.refresh();
            }),
        },
      });
      router.refresh();
    });
  }

  const stagingGroupsByEngagement: Record<string, StagingGroup[]> = {};
  for (const g of stagingGroups) {
    (stagingGroupsByEngagement[g.engagement_id] ??= []).push(g);
  }

  function syncSelected(id: string | null) {
    setSelectedId(id);
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("task", id);
    else params.delete("task");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const engagementFilter = searchParams.get("engagement");
  const mode: GroupMode = searchParams.get("group") === "staging" ? "staging" : "branch";
  const hasPersonalTasks = tasks.some((t) => t.engagement_id === null);
  const visibleTasks =
    engagementFilter === null
      ? tasks
      : engagementFilter === "personal"
        ? tasks.filter((t) => t.engagement_id === null)
        : tasks.filter((t) => t.engagement_id === engagementFilter);

  const selectedTask = tasks.find((t) => t.id === selectedId) ?? null;

  // The engagement a new group is created under — the selected filter, or the
  // sole engagement. Null when it's ambiguous ("All"/"Personal" + many clients).
  const activeEngagementId =
    engagementFilter && engagementFilter !== "personal"
      ? engagementFilter
      : engagements.length === 1
        ? engagements[0].id
        : null;

  // Staging mode: include every group for the visible engagements — even empty
  // ones — so you can see and manage groups before assigning tasks.
  const visibleGroupDefs =
    engagementFilter === null
      ? stagingGroups
      : engagementFilter === "personal"
        ? []
        : stagingGroups.filter((g) => g.engagement_id === engagementFilter);

  const showFilters =
    engagements.length > 1 || (engagements.length > 0 && hasPersonalTasks);

  function doCreate() {
    const name = newName.trim();
    if (!name || !activeEngagementId) return;
    startTransition(async () => {
      const res = await createStagingGroup(activeEngagementId, name);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setNewName("");
      setCreating(false);
      router.refresh();
    });
  }

  function doRename(id: string) {
    const name = renameValue.trim();
    if (!name) {
      setRenamingId(null);
      return;
    }
    startTransition(async () => {
      const res = await renameStagingGroup(id, name);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setRenamingId(null);
      router.refresh();
    });
  }

  function doDelete(id: string) {
    startTransition(async () => {
      const res = await deleteStagingGroup(id);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setConfirmDeleteId(null);
      router.refresh();
    });
  }

  function renderGroupActions(g: TaskBucket) {
    if (mode !== "staging" || g.groupId === null) return null;
    const id = g.groupId;
    if (renamingId === id) {
      return (
        <div className="krowe-stage-group-actions">
          <input
            aria-label="Rename staging group"
            className="krowe-stage-newgroup-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            maxLength={80}
            disabled={isPending}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                doRename(id);
              } else if (e.key === "Escape") {
                setRenamingId(null);
              }
            }}
          />
          <button
            type="button"
            className="krowe-stage-group-action"
            aria-label="Save name"
            disabled={isPending}
            onClick={() => doRename(id)}
          >
            <Check width={14} height={14} />
          </button>
          <button
            type="button"
            className="krowe-stage-group-action"
            aria-label="Cancel rename"
            disabled={isPending}
            onClick={() => setRenamingId(null)}
          >
            <X width={14} height={14} />
          </button>
        </div>
      );
    }
    if (confirmDeleteId === id) {
      return (
        <div className="krowe-stage-group-actions">
          <span className="krowe-stage-section-count">Delete group?</span>
          <button
            type="button"
            className="krowe-stage-group-action danger"
            aria-label="Confirm delete"
            disabled={isPending}
            onClick={() => doDelete(id)}
          >
            <Check width={14} height={14} />
          </button>
          <button
            type="button"
            className="krowe-stage-group-action"
            aria-label="Cancel delete"
            disabled={isPending}
            onClick={() => setConfirmDeleteId(null)}
          >
            <X width={14} height={14} />
          </button>
        </div>
      );
    }
    return (
      <div className="krowe-stage-group-actions">
        <button
          type="button"
          className="krowe-stage-group-action"
          aria-label={`Rename ${g.label}`}
          disabled={isPending}
          onClick={() => {
            setRenamingId(id);
            setRenameValue(g.label);
          }}
        >
          <Pencil width={13} height={13} />
        </button>
        <button
          type="button"
          className="krowe-stage-group-action danger"
          aria-label={`Delete ${g.label}`}
          disabled={isPending}
          onClick={() => setConfirmDeleteId(id)}
        >
          <Trash2 width={13} height={13} />
        </button>
      </div>
    );
  }

  function renderGroup(g: TaskBucket, section?: "staged" | "shipped") {
    const purpose = mode === "branch" && g.branch ? purposes[g.branch] : null;
    // A real branch queued for the next push can be shipped in one click.
    const canShip =
      mode === "branch" && section === "staged" && g.branch !== null && g.tasks.length > 0;
    const isEmpty = g.tasks.length === 0;
    return (
      <div key={g.key} className={`krowe-stage-group${isEmpty ? " is-empty" : ""}`}>
        <div className="krowe-stage-group-head">
          {mode === "branch" ? (
            <GitBranch width={14} height={14} strokeWidth={2} />
          ) : (
            <Layers width={14} height={14} strokeWidth={2} />
          )}
          <span className="krowe-stage-branch">{g.label}</span>
          {purpose && <span className="krowe-stage-purpose">{purpose}</span>}
          <span className="krowe-stage-count">{g.tasks.length}</span>
          {renderGroupActions(g)}
          {canShip && (
            <button
              type="button"
              className="krowe-stage-ship"
              disabled={isPending}
              onClick={() => shipBranch(g)}
            >
              <Rocket width={13} height={13} />
              Mark as pushed to main
            </button>
          )}
        </div>
        {g.tasks.length > 0 && (
          <div className="krowe-stage-cards">
            {g.tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                role="builder"
                engagementTitle={engagementMap.get(task.engagement_id)}
                onSelect={(t) => syncSelected(t.id)}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  function renderSection(
    kind: "staged" | "shipped",
    title: string,
    empty: string,
    groups: TaskBucket[]
  ) {
    const total = groups.reduce((n, g) => n + g.tasks.length, 0);
    return (
      <section className="krowe-stage-section">
        <div className="krowe-stage-section-head">
          <span className={`krowe-stage-badge ${kind}`}>{title}</span>
          {groups.length > 0 && (
            <span className="krowe-stage-section-count">
              {plural(groups.length, "branch", "branches")} · {plural(total, "task")}
            </span>
          )}
          <span className="krowe-stage-rule" />
          {kind === "staged" && engagements.length > 0 && (
            <button
              type="button"
              className="krowe-stage-check"
              disabled={checking}
              onClick={() => setPollTick((n) => n + 1)}
              title="Check GitHub for branches merged into main"
            >
              <RefreshCw width={13} height={13} />
              {checking ? "Checking…" : "Check for pushes"}
            </button>
          )}
        </div>
        {groups.length === 0 ? (
          <div className="krowe-stage-empty">{empty}</div>
        ) : (
          <div className="krowe-stage-groups">
            {groups.map((g) => renderGroup(g, kind))}
          </div>
        )}
      </section>
    );
  }

  // Live branch names for the engagements currently in scope, so branch mode can
  // surface repo branches that have no queued work yet. Default branches are
  // excluded — main isn't a staging branch, it's where work is pushed to.
  const scopedEngagementIds =
    engagementFilter === null
      ? engagements.map((e) => e.id)
      : engagementFilter === "personal"
        ? []
        : [engagementFilter];
  const liveBranchNames: string[] = [];
  const excludeFromEmpty = new Set<string>();
  for (const eid of scopedEngagementIds) {
    const pb = branchesByEngagement[eid];
    if (!pb) continue;
    if (pb.defaultBranch) excludeFromEmpty.add(pb.defaultBranch);
    for (const b of pb.branches) liveBranchNames.push(b.name);
  }
  // A branch already shown under Shipped shouldn't reappear as an empty row.
  for (const t of visibleTasks) {
    if (t.pushed_to_main && t.branch_name) excludeFromEmpty.add(t.branch_name);
  }

  // Branch mode splits by pushed_to_main (queued vs shipped); staging mode shows
  // one list of groups (the group is the organizing unit, not the push state).
  const stagedGroups = groupTasksByBranch(
    visibleTasks.filter((t) => !t.pushed_to_main),
    liveBranchNames,
    excludeFromEmpty
  );
  const shippedGroups = groupTasksByBranch(visibleTasks.filter((t) => t.pushed_to_main));
  const groups = groupTasksByStagingGroup(visibleTasks, visibleGroupDefs);

  // Flat, on-screen order of task ids for the sheet's prev/next stepping. Empty
  // branch rows contribute nothing, so navigation walks only real tasks.
  const orderedIds =
    mode === "branch"
      ? [...stagedGroups, ...shippedGroups].flatMap((g) => g.tasks.map((t) => t.id))
      : groups.flatMap((g) => g.tasks.map((t) => t.id));

  return (
    <>
      <div className="krowe-stage-toolbar">
        <div className="krowe-stage-groupby">
          <span className="krowe-stage-groupby-label">Group by</span>
          <div className="krowe-stage-groupby-seg" role="group" aria-label="Group by">
            <button
              type="button"
              className={`krowe-stage-groupby-btn ${mode === "branch" ? "active" : ""}`}
              aria-pressed={mode === "branch"}
              onClick={() => setParam("group", null)}
            >
              Branch
            </button>
            <button
              type="button"
              className={`krowe-stage-groupby-btn ${mode === "staging" ? "active" : ""}`}
              aria-pressed={mode === "staging"}
              onClick={() => setParam("group", "staging")}
            >
              Staging
            </button>
          </div>
        </div>

        {mode === "staging" &&
          (creating ? (
            <div className="krowe-stage-newgroup-edit">
              <input
                aria-label="New staging group name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Group name (e.g. Release 1.2)"
                maxLength={80}
                disabled={isPending}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    doCreate();
                  } else if (e.key === "Escape") {
                    setCreating(false);
                    setNewName("");
                  }
                }}
              />
              <button
                type="button"
                className="krowe-stage-groupby-btn active"
                disabled={isPending || !newName.trim()}
                onClick={doCreate}
              >
                Add
              </button>
              <button
                type="button"
                className="krowe-staging-cancel"
                disabled={isPending}
                onClick={() => {
                  setCreating(false);
                  setNewName("");
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="krowe-stage-newgroup"
              disabled={!activeEngagementId}
              title={
                activeEngagementId
                  ? undefined
                  : "Pick a client above to add a group"
              }
              onClick={() => setCreating(true)}
            >
              <Plus width={14} height={14} />
              New group
            </button>
          ))}
      </div>

      {showFilters && (
        <div className="krowe-filter-row">
          <button
            type="button"
            className={`krowe-filter-chip ${engagementFilter === null ? "active" : ""}`}
            onClick={() => setParam("engagement", null)}
          >
            All <span className="count">{tasks.length}</span>
          </button>
          {engagements.map((e) => (
            <button
              key={e.id}
              type="button"
              className={`krowe-filter-chip ${engagementFilter === e.id ? "active" : ""}`}
              onClick={() => setParam("engagement", e.id)}
            >
              {e.title}{" "}
              <span className="count">{tasks.filter((t) => t.engagement_id === e.id).length}</span>
            </button>
          ))}
          {hasPersonalTasks && (
            <button
              type="button"
              className={`krowe-filter-chip ${engagementFilter === "personal" ? "active" : ""}`}
              onClick={() => setParam("engagement", "personal")}
            >
              Personal{" "}
              <span className="count">{tasks.filter((t) => t.engagement_id === null).length}</span>
            </button>
          )}
        </div>
      )}

      {mode === "branch" ? (
        stagedGroups.length === 0 && shippedGroups.length === 0 ? (
          <div className="krowe-column-empty" style={{ maxWidth: 400 }}>
            Nothing here yet — finish a task and it lands in staging, ready to group by branch.
          </div>
        ) : (
          <div className="krowe-stage-wrap">
            {renderSection(
              "staged",
              "Next push",
              "Nothing queued — completed work that isn't pushed to main shows up here.",
              stagedGroups
            )}
            {renderSection(
              "shipped",
              "Shipped",
              "Nothing shipped yet — tasks marked “pushed to main” land here once they go live.",
              shippedGroups
            )}
          </div>
        )
      ) : groups.length === 0 ? (
        <div className="krowe-column-empty" style={{ maxWidth: 420 }}>
          {activeEngagementId
            ? "No staging groups yet — add one above, then assign done tasks to it from the task’s deliverable."
            : "Pick a client above to create and manage its staging groups."}
        </div>
      ) : (
        <div className="krowe-stage-wrap">
          <div className="krowe-stage-groups">
            {groups.map((g) => renderGroup(g))}
          </div>
        </div>
      )}

      <TaskDetailSheet
        task={selectedTask}
        role="builder"
        currentUserId={currentUserId}
        engagementTitle={selectedTask ? engagementMap.get(selectedTask.engagement_id) : undefined}
        onOpenChange={(open) => !open && syncSelected(null)}
        branchesByEngagement={branchesByEngagement}
        stagingGroupsByEngagement={stagingGroupsByEngagement}
        siblingIds={orderedIds}
        onNavigate={syncSelected}
      />
    </>
  );
}
