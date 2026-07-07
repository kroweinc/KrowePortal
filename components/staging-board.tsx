"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { GitBranch, Layers, Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { TaskCard } from "@/components/task-card";
import { TaskDetailSheet } from "@/components/task-detail-sheet";
import {
  createStagingGroup,
  renameStagingGroup,
  deleteStagingGroup,
} from "@/lib/actions/staging-groups";
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

  function renderGroup(g: TaskBucket) {
    const purpose = mode === "branch" && g.branch ? purposes[g.branch] : null;
    return (
      <div key={g.key} className="krowe-stage-group">
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
        </div>
        {groups.length === 0 ? (
          <div className="krowe-stage-empty">{empty}</div>
        ) : (
          <div className="krowe-stage-groups">{groups.map(renderGroup)}</div>
        )}
      </section>
    );
  }

  // Branch mode splits by pushed_to_main (queued vs shipped); staging mode shows
  // one list of groups (the group is the organizing unit, not the push state).
  const stagedGroups = groupTasksByBranch(visibleTasks.filter((t) => !t.pushed_to_main));
  const shippedGroups = groupTasksByBranch(visibleTasks.filter((t) => t.pushed_to_main));
  const groups = groupTasksByStagingGroup(visibleTasks, visibleGroupDefs);

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
        visibleTasks.length === 0 ? (
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
          <div className="krowe-stage-groups">{groups.map(renderGroup)}</div>
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
      />
    </>
  );
}
