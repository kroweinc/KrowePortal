"use client";

import { useEffect, useState, useTransition, useOptimistic } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, CheckSquare, ChevronUp, Plus, Trash2, X } from "lucide-react";
import { TaskCard } from "@/components/task-card";
import { openNewTask } from "@/components/add-task-button";
import { TaskDetailSheet } from "@/components/task-detail-sheet";
import { useTaskSort } from "@/components/task-sort-context";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { updateTaskStatus, reorderTask, deleteTasks } from "@/lib/actions/tasks";
import {
  pollCommitTaskMatches,
  confirmMatchedTaskDone,
  dismissTaskCommitMatch,
} from "@/lib/actions/commit-task-matches";
import type { PendingCommitMatch } from "@/lib/actions/get-commit-task-matches";
import { commitDoneDeliverable } from "@/lib/tasks/commit-done-deliverable";
import { useRequestDone } from "@/components/done-deliverable-provider";
import {
  isAwaitingApproval,
  sortWithApprovalPin,
  sortTasksByKey,
  STATUS_LABELS,
} from "@/lib/utils";
import type { PreloadedBranches } from "@/lib/actions/get-engagement-branches";
import type { Task, Engagement, TaskStatus, StagingGroup } from "@/lib/types";

const sortTasks = sortWithApprovalPin<Task>;

const DONE_PREVIEW_COUNT = 3;

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "backlog",     label: "Backlog" },
  { status: "todo",        label: "To-Do" },
  { status: "in_progress", label: "In Progress" },
  { status: "done",        label: "Done" },
];

type DropTarget = { taskId: string; position: "before" | "after" };
type OptimisticAction =
  | { type: "status"; taskId: string; status: TaskStatus }
  | { type: "reorder"; taskId: string; sort_order: number }
  | { type: "remove"; taskIds: string[] };

interface TaskBoardProps {
  tasks: Task[];
  engagements: Engagement[];
  currentUserId: string;
  branchesByEngagement?: Record<string, PreloadedBranches>;
  stagingGroupsByEngagement?: Record<string, StagingGroup[]>;
  /** Unresolved "a commit on main looks like it finished this" suggestions, by task id. */
  commitMatches?: Record<string, PendingCommitMatch>;
}

export function TaskBoard({
  tasks,
  engagements,
  currentUserId,
  branchesByEngagement,
  stagingGroupsByEngagement,
  commitMatches,
}: TaskBoardProps) {
  const engagementMap = new Map(engagements.map((e) => [e.id, e.title]));
  const requestDone = useRequestDone();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("task"));
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);
  const [draggingTask, setDraggingTask] = useState<Task | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [showAllDone, setShowAllDone] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirm, confirmDialog] = useConfirm();
  const [, startTransition] = useTransition();

  const [optimisticTasks, dispatchOptimistic] = useOptimistic(
    tasks,
    (current, action: OptimisticAction) => {
      if (action.type === "status")
        return current.map((t) => t.id === action.taskId ? { ...t, status: action.status } : t);
      if (action.type === "reorder")
        return current.map((t) => t.id === action.taskId ? { ...t, sort_order: action.sort_order } : t);
      if (action.type === "remove")
        return current.filter((t) => !action.taskIds.includes(t.id));
      return current;
    }
  );

  const selectedTask = optimisticTasks.find((t) => t.id === selectedId) ?? null;

  // ?task= is seeded into state at mount, which is enough for a cold load but
  // not for a link followed while the board is already up — a soft navigation
  // to the same route doesn't remount. Mirroring it keeps every /b?task=<id>
  // link live (the meeting panel's sibling rows, the meeting page, a pasted
  // link) and hands the sheet to browser Back/Forward. Adjusted during render
  // rather than in an effect, so the sheet never paints a frame on the old id;
  // syncSelected's own router.replace lands here as a no-op, having set the
  // same id already.
  const taskParam = searchParams.get("task");
  const [lastTaskParam, setLastTaskParam] = useState(taskParam);
  if (taskParam !== lastTaskParam) {
    setLastTaskParam(taskParam);
    setSelectedId(taskParam);
  }

  // ── "You forgot to mark this done" ──
  // Scan new default-branch commits against the open tasks once per mount. Cheap
  // by design: commits already scanned are filtered out server-side before the
  // model runs, so an unchanged repo costs one cached GitHub call and no AI.
  // Refresh only when something new actually matched.
  const [clearedMatches, setClearedMatches] = useState<Set<string>>(new Set());

  useEffect(() => {
    const ids = engagements.map((e) => e.id);
    // Nothing to match against unless something is still open.
    if (ids.length === 0 || !tasks.some((t) => t.status !== "done")) return;
    let cancelled = false;
    pollCommitTaskMatches(ids)
      .then((r) => {
        if (!cancelled && r.taskIds.length > 0) router.refresh();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Mount-only; engagements and router are stable for the life of the board.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function restoreMatch(taskId: string) {
    setClearedMatches((prev) => {
      const next = new Set(prev);
      next.delete(taskId);
      return next;
    });
  }

  // Confirm goes straight to Done and skips approval — the commit was read off
  // the default branch, so the work is already on main and there's nothing left
  // for an operator to gate. On an auto-applied match the task is already done;
  // confirming only stands behind it, which is what releases the operator's
  // "delivered" mail.
  function confirmMatch(task: Task) {
    const match = commitMatches?.[task.id];
    setClearedMatches((prev) => new Set(prev).add(task.id));
    startTransition(async () => {
      dispatchOptimistic({ type: "status", taskId: task.id, status: "done" });
      const r = await confirmMatchedTaskDone(task.id);
      if ("error" in r) {
        toast.error(r.error);
        restoreMatch(task.id);
      } else {
        toast.success(match?.autoApplied ? "Kept as done" : "Marked done — shipped to main");
      }
    });
  }

  // On an auto-applied match this is an undo, not a dismissal: the server puts
  // the task back where it was, so the card flies back to its old column rather
  // than just losing its card. priorStatus comes from the same row the card
  // rendered from, so the optimistic move matches what the server will do.
  function dismissMatch(task: Task) {
    const match = commitMatches?.[task.id];
    const priorStatus = match?.autoApplied ? match.priorStatus : null;
    setClearedMatches((prev) => new Set(prev).add(task.id));
    startTransition(async () => {
      if (priorStatus) {
        dispatchOptimistic({ type: "status", taskId: task.id, status: priorStatus });
      }
      const r = await dismissTaskCommitMatch(task.id);
      if ("error" in r) {
        toast.error(r.error);
        restoreMatch(task.id);
      } else if (r.restoredStatus) {
        toast.success(`Moved back to ${STATUS_LABELS[r.restoredStatus]}`);
      }
    });
  }

  // Sort lives in the header (next to Staging / Tasks from meeting) via a shared
  // context so the control and the board stay in sync — see TaskSortProvider.
  const { sortKey } = useTaskSort();

  /**
   * A task the scan marked done on its own goes to the head of its column, above
   * whatever the sort says, because it's the one card asking the builder a
   * question. That also keeps it clear of the DONE_PREVIEW_COUNT cut, so it can
   * never end up hidden behind "N more done".
   *
   * Applied here rather than inside sortWithApprovalPin (lib/utils.ts): the pin
   * has to hold under every sort key including the pure ones, and the operator's
   * list shares that util and has no auto-done concept.
   */
  function liftAutoDone(columnTasks: Task[]): Task[] {
    const isAuto = (t: Task) =>
      !clearedMatches.has(t.id) && commitMatches?.[t.id]?.autoApplied === true;
    if (!columnTasks.some(isAuto)) return columnTasks;
    return [...columnTasks.filter(isAuto), ...columnTasks.filter((t) => !isAuto(t))];
  }

  // null = All, "personal" = tasks with no engagement, otherwise an engagement id
  const engagementFilter = searchParams.get("engagement");
  const hasPersonalTasks = tasks.some((t) => t.engagement_id === null);
  const visibleTasks =
    engagementFilter === null
      ? optimisticTasks
      : engagementFilter === "personal"
        ? optimisticTasks.filter((t) => t.engagement_id === null)
        : optimisticTasks.filter((t) => t.engagement_id === engagementFilter);

  function syncSelected(id: string | null) {
    setSelectedId(id);
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("task", id); else params.delete("task");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function setEngagementFilter(value: string | null) {
    // Drop any selection when the visible set changes — otherwise a bulk delete
    // could remove tasks the new filter no longer shows.
    setSelectedIds(new Set());
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("engagement", value); else params.delete("engagement");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  // "Mark as done" from any board trigger (advance button, right-click menu,
  // drag-to-Done): open the deliverable dialog, then commit inside the board's
  // optimistic transition so the card jumps to Done the instant Save is clicked
  // and holds until the server reconciles — no dialog "Saving…" wait.
  function markDoneFlow(task: Task) {
    if (task.status === "done") return;
    requestDone({
      task,
      onSubmit: (payload) =>
        startTransition(async () => {
          dispatchOptimistic({ type: "status", taskId: task.id, status: "done" });
          await commitDoneDeliverable(task, payload);
        }),
    });
  }

  // Plain status move (card advance button + right-click menu), routed through
  // the same optimistic dispatch the drag-and-drop uses so the card jumps
  // columns instantly instead of waiting on the server round-trip + revalidate.
  // Done routes through the deliverable dialog; approval keeps its own flow.
  function moveStatus(taskId: string, status: TaskStatus) {
    if (status === "done") {
      const task = optimisticTasks.find((t) => t.id === taskId);
      if (task) markDoneFlow(task);
      return;
    }
    startTransition(async () => {
      dispatchOptimistic({ type: "status", taskId, status });
      const r = await updateTaskStatus(taskId, status);
      if (r && "error" in r && r.error) toast.error(r.error);
    });
  }

  function handleColumnDrop(e: React.DragEvent, status: TaskStatus) {
    e.preventDefault();
    setDragOverStatus(null);
    setDropTarget(null);
    setDraggingTask(null);
    const taskId = e.dataTransfer.getData("taskId");
    if (!taskId) return;

    if (status === "done") {
      const droppedTask = optimisticTasks.find((t) => t.id === taskId);
      if (droppedTask && droppedTask.status !== "done") {
        markDoneFlow(droppedTask);
        return;
      }
    }

    startTransition(async () => {
      dispatchOptimistic({ type: "status", taskId, status });
      await updateTaskStatus(taskId, status);
    });
  }

  function handleCardDragOver(e: React.DragEvent, targetTask: Task) {
    if (!draggingTask) return;
    if (draggingTask.priority !== targetTask.priority) return;
    if (draggingTask.status !== targetTask.status) return;
    // Approval-pinned cards sit above the priority groups — reordering
    // across the pin boundary would compute nonsense sort_orders.
    if (isAwaitingApproval(draggingTask) !== isAwaitingApproval(targetTask)) return;
    if (draggingTask.id === targetTask.id) return;
    e.stopPropagation(); e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const position: "before" | "after" = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
    if (dropTarget?.taskId !== targetTask.id || dropTarget?.position !== position)
      setDropTarget({ taskId: targetTask.id, position });
    setDragOverStatus(null);
  }

  function handleCardDrop(e: React.DragEvent, targetTask: Task) {
    if (!draggingTask) return;
    if (draggingTask.priority !== targetTask.priority) return;
    if (draggingTask.status !== targetTask.status) return;
    if (isAwaitingApproval(draggingTask) !== isAwaitingApproval(targetTask)) return;
    if (draggingTask.id === targetTask.id) { setDropTarget(null); return; }
    e.stopPropagation(); e.preventDefault();
    const target = dropTarget;
    const sourceTask = draggingTask;
    setDropTarget(null); setDraggingTask(null);
    if (!target) return;
    const group = sortTasks(
      optimisticTasks.filter(
        (t) =>
          t.status === targetTask.status &&
          t.priority === targetTask.priority &&
          isAwaitingApproval(t) === isAwaitingApproval(targetTask) &&
          t.id !== sourceTask.id
      )
    );
    const targetIdx = group.findIndex((t) => t.id === targetTask.id);
    let newOrder: number;
    if (target.position === "before") {
      newOrder = targetIdx === 0
        ? (group[0].sort_order ?? 0) - 1000
        : ((group[targetIdx - 1].sort_order ?? 0) + (group[targetIdx].sort_order ?? 0)) / 2;
    } else {
      newOrder = targetIdx === group.length - 1
        ? (group[group.length - 1].sort_order ?? 0) + 1000
        : ((group[targetIdx].sort_order ?? 0) + (group[targetIdx + 1].sort_order ?? 0)) / 2;
    }
    const taskId = sourceTask.id;
    startTransition(async () => {
      dispatchOptimistic({ type: "reorder", taskId, sort_order: newOrder });
      await reorderTask(taskId, newOrder);
    });
  }

  // ── Multi-select + bulk delete ──
  const selectionMode = selectedIds.size > 0;
  const allVisibleSelected =
    visibleTasks.length > 0 && visibleTasks.every((t) => selectedIds.has(t.id));

  function toggleSelect(task: Task) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(task.id)) next.delete(task.id);
      else next.add(task.id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds(allVisibleSelected ? new Set() : new Set(visibleTasks.map((t) => t.id)));
  }

  async function bulkDelete() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const label = `${ids.length} task${ids.length === 1 ? "" : "s"}`;
    if (
      !(await confirm({
        title: `Delete ${label}?`,
        description: "This permanently removes the selected tasks. This can’t be undone.",
        confirmText: `Delete ${label}`,
        cancelText: "Cancel",
        icon: Trash2,
        tone: "danger",
      }))
    )
      return;
    // Clear the selection up front so the bar and checkboxes drop away instantly;
    // the optimistic remove then vanishes the cards inside the transition.
    setSelectedIds(new Set());
    startTransition(async () => {
      dispatchOptimistic({ type: "remove", taskIds: ids });
      const r = await deleteTasks(ids);
      if (r && "error" in r && r.error) {
        toast.error(r.error);
        // The optimistic revert brings the cards back — restore the selection
        // too so the user can just retry instead of re-picking everything.
        setSelectedIds(new Set(ids));
      } else if (r && "deletedIds" in r) {
        const n = r.deletedIds.length;
        toast.success(`Deleted ${n} task${n === 1 ? "" : "s"}`);
      }
    });
  }

  const showFilters = engagements.length > 1 || (engagements.length > 0 && hasPersonalTasks);

  return (
    <>
      {showFilters && (
        <div className="krowe-board-controls">
          <div className="krowe-filter-row">
            <button
              type="button"
              className={`krowe-filter-chip ${engagementFilter === null ? "active" : ""}`}
              onClick={() => setEngagementFilter(null)}
            >
              All <span className="count">{tasks.length}</span>
            </button>
            {engagements.map((e) => (
              <button
                key={e.id}
                type="button"
                className={`krowe-filter-chip ${engagementFilter === e.id ? "active" : ""}`}
                onClick={() => setEngagementFilter(e.id)}
              >
                {e.title}{" "}
                <span className="count">{tasks.filter((t) => t.engagement_id === e.id).length}</span>
              </button>
            ))}
            {hasPersonalTasks && (
              <button
                type="button"
                className={`krowe-filter-chip ${engagementFilter === "personal" ? "active" : ""}`}
                onClick={() => setEngagementFilter("personal")}
              >
                Personal{" "}
                <span className="count">{tasks.filter((t) => t.engagement_id === null).length}</span>
              </button>
            )}
          </div>
        </div>
      )}
      {visibleTasks.length === 0 ? (
        <div className="krowe-column-empty" style={{ maxWidth: 400 }}>
          {optimisticTasks.length === 0
            ? "No tasks yet — hit the + button to add something to the queue."
            : "No tasks for this client yet — hit the + button to add one."}
        </div>
      ) : (
      <div className="krowe-board">
        {COLUMNS.map(({ status, label }) => {
          const columnTasks = liftAutoDone(
            sortTasksByKey(visibleTasks.filter((t) => t.status === status), sortKey)
          );
          // Done stays capped at a top-3 preview unless expanded.
          const collapseDone =
            status === "done" && !showAllDone && columnTasks.length > DONE_PREVIEW_COUNT;
          const shownTasks = collapseDone ? columnTasks.slice(0, DONE_PREVIEW_COUNT) : columnTasks;
          const hiddenDone = columnTasks.length - shownTasks.length;
          const isOver = dragOverStatus === status;
          return (
            <div
              key={status}
              className={`krowe-column ${isOver ? "drag-over" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragOverStatus(status); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) { setDragOverStatus(null); setDropTarget(null); } }}
              onDrop={(e) => handleColumnDrop(e, status)}
            >
              <div className="krowe-column-head">
                <span className="krowe-column-label">{label}</span>
                <span className="krowe-column-count">{columnTasks.length}</span>
                <span className="krowe-column-rule" />
                <button
                  type="button"
                  className="krowe-column-add"
                  title="Add a task"
                  onClick={openNewTask}
                >
                  <Plus width={15} height={15} strokeWidth={2} />
                </button>
              </div>
              {columnTasks.length === 0 ? (
                <div className="krowe-column-empty">{isOver ? "Drop here" : "Empty"}</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                  {shownTasks.map((task) => (
                    <div
                      key={task.id}
                      style={{ marginBottom: 10 }}
                      onDragOver={(e) => handleCardDragOver(e, task)}
                      onDrop={(e) => handleCardDrop(e, task)}
                    >
                      {dropTarget?.taskId === task.id && dropTarget.position === "before" && (
                        <div className="krowe-drop-indicator" />
                      )}
                      <TaskCard
                        task={task}
                        role="builder"
                        engagementTitle={engagementMap.get(task.engagement_id)}
                        onSelect={(t) => syncSelected(t.id)}
                        onStatusMove={moveStatus}
                        onDragStart={(t) => setDraggingTask(t)}
                        onDragEnd={() => { setDraggingTask(null); setDropTarget(null); }}
                        selected={selectedIds.has(task.id)}
                        selectionMode={selectionMode}
                        onToggleSelect={toggleSelect}
                        commitMatch={
                          clearedMatches.has(task.id) ? undefined : commitMatches?.[task.id]
                        }
                        onConfirmMatch={confirmMatch}
                        onDismissMatch={dismissMatch}
                      />
                      {dropTarget?.taskId === task.id && dropTarget.position === "after" && (
                        <div className="krowe-drop-indicator" />
                      )}
                    </div>
                  ))}
                  {collapseDone && (
                    <button
                      type="button"
                      className="krowe-done-more"
                      onClick={() => setShowAllDone(true)}
                    >
                      <CheckCircle2 width={14} height={14} strokeWidth={2} />
                      {hiddenDone} more done — click to view
                    </button>
                  )}
                  {status === "done" && showAllDone && columnTasks.length > DONE_PREVIEW_COUNT && (
                    <button
                      type="button"
                      className="krowe-done-more"
                      onClick={() => setShowAllDone(false)}
                    >
                      <ChevronUp width={14} height={14} strokeWidth={2} />
                      Show fewer
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}
      {selectionMode && (
        <div className="krowe-bulk-bar" role="toolbar" aria-label="Selected tasks">
          <span className="krowe-bulk-count">
            {selectedIds.size} selected
          </span>
          <button type="button" className="krowe-bulk-btn" onClick={toggleSelectAll}>
            <CheckSquare width={14} height={14} strokeWidth={2} />
            {allVisibleSelected ? "Deselect all" : "Select all"}
          </button>
          <span className="krowe-bulk-sep" />
          <button type="button" className="krowe-bulk-btn danger" onClick={bulkDelete}>
            <Trash2 width={14} height={14} strokeWidth={2} />
            Delete {selectedIds.size}
          </button>
          <button
            type="button"
            className="krowe-bulk-btn icon"
            aria-label="Clear selection"
            onClick={() => setSelectedIds(new Set())}
          >
            <X width={15} height={15} strokeWidth={2} />
          </button>
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
      {confirmDialog}
    </>
  );
}
