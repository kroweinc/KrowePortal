"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  Check,
  CheckCircle2,
  ChevronUp,
  Clock,
  Hammer,
  Inbox,
  Layers,
  ListChecks,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { TaskDetailSheet } from "@/components/task-detail-sheet";
import { DeliveryChips } from "@/components/design-atoms";
import { TaskTypeBadge, TaskTags } from "@/components/task-type-badge";
import { PlainEnglishProvider } from "@/components/plain-english-context";
import { RequestChangesDialog } from "@/components/request-changes-dialog";
import { deleteTask, approveTask } from "@/lib/actions/tasks";
import { isAwaitingApproval, sortByPriority, relativeTime, PRIORITY_LABELS } from "@/lib/utils";
import { formatHoursRange } from "@/lib/format-estimate";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useTaskMenu } from "@/components/task-menu";
import { ContextMenu } from "@/components/ui/context-menu";
import type { Task } from "@/lib/types";

interface OperatorTaskListProps {
  tasks: Task[];
  currentUserId: string;
  builderName: string | null;
}

/* ── Stat tile ── */
function StatTile({
  icon: IconCmp,
  cls,
  num,
  label,
  hot,
}: {
  icon: React.ComponentType<{ width?: number; height?: number }>;
  cls: string;
  num: number;
  label: string;
  hot?: boolean;
}) {
  return (
    <div className={`krowe-opd-stat ${hot ? "is-hot" : ""}`}>
      <div className="krowe-opd-stat-top">
        <span className="krowe-opd-stat-num">{num}</span>
        <span className={`krowe-opd-stat-ico ${cls}`}>
          <IconCmp width={17} height={17} />
        </span>
      </div>
      <div className="krowe-opd-stat-lab">{label}</div>
    </div>
  );
}

/* ── Panel shell ── */
function Panel({
  icon: IconCmp,
  cls,
  title,
  count,
  hot,
  note,
  children,
}: {
  icon: React.ComponentType<{ width?: number; height?: number }>;
  cls: string;
  title: string;
  count: number;
  hot?: boolean;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="krowe-opd-panel">
      <div className="krowe-opd-panel-head">
        <span className={`krowe-opd-sec-ico ${cls}`}>
          <IconCmp width={16} height={16} />
        </span>
        <div className="krowe-opd-panel-titles">
          <div className="krowe-opd-panel-title">
            {title}
            <span className={`krowe-opd-count ${hot ? "hot" : ""}`}>{count}</span>
          </div>
          {note && <div className="krowe-opd-panel-note">{note}</div>}
        </div>
      </div>
      <div className="krowe-opd-panel-body">{children}</div>
    </div>
  );
}

function EmptyState({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="krowe-opd-empty">
      <div className="emp-title">{title}</div>
      <div className="emp-sub">{sub}</div>
    </div>
  );
}

/* ── Review card: submitted work awaiting the operator's sign-off ── */
function ReviewCard({
  task,
  builderFirst,
  builderFull,
  onSelect,
  onDelete,
  onRequestChanges,
}: {
  task: Task;
  builderFirst: string;
  builderFull: string;
  onSelect: () => void;
  onDelete: () => Promise<void>;
  onRequestChanges: () => void;
}) {
  const router = useRouter();
  const { menu, items } = useTaskMenu({ task, role: "operator", onOpen: onSelect, onDelete });
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Bare-URL notes render as the Live chip in DeliveryChips — don't repeat them.
  const note = task.completion_note?.trim();
  const noteText = note && !/^https?:\/\/\S+$/.test(note) ? note : null;
  const checks = (task.task_subtasks ?? []).filter((s) => s.completed);
  const hasChecklist = checks.length > 0 || !!noteText;

  function handleApprove(e: React.MouseEvent) {
    e.stopPropagation();
    startTransition(async () => {
      const result = await approveTask(task.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Approved — ${builderFull} has been notified`);
      router.refresh();
    });
  }

  return (
    <div
      className={`krowe-opd-card priority-${task.priority}`}
      onClick={onSelect}
      onContextMenu={menu.openAtEvent}
    >
      <div className="krowe-rail" />
      <div className="krowe-opd-card-body">
        <div className="krowe-opd-card-top">
          <div className="krowe-opd-card-title">{task.title}</div>
          <span className={`krowe-chip krowe-chip-priority ${task.priority}`}>
            {PRIORITY_LABELS[task.priority]}
          </span>
        </div>
        {task.description && <p className="krowe-opd-card-desc">{task.description}</p>}
        <DeliveryChips task={task} />

        {hasChecklist && (
          <div style={{ marginTop: 10 }}>
            <button
              className="krowe-opd-btn krowe-opd-btn-ghost"
              style={{ height: 28, padding: "0 10px", fontSize: 12 }}
              onClick={(e) => {
                e.stopPropagation();
                setOpen((o) => !o);
              }}
            >
              {open ? (
                <ChevronUp width={14} height={14} />
              ) : (
                <ListChecks width={14} height={14} />
              )}
              {open
                ? "Hide checklist"
                : `What ${builderFirst} verified (${checks.length || 1})`}
            </button>
            {open && (
              <ul className="krowe-opd-checklist">
                {checks.map((s) => (
                  <li key={s.id}>
                    <span className="ck">
                      <Check width={11} height={11} strokeWidth={3} />
                    </span>
                    {s.title}
                  </li>
                ))}
                {noteText && <li className="note">{noteText}</li>}
              </ul>
            )}
          </div>
        )}

        <div className="krowe-opd-review-foot">
          <span className="krowe-opd-submitted">
            <span className="si">
              <CheckCircle2 width={15} height={15} />
            </span>
            {builderFirst} submitted this
            {task.approval_sent_at ? <> · {relativeTime(task.approval_sent_at)}</> : null}
          </span>
          <span className="grow" />
          <button
            className="krowe-opd-btn krowe-opd-btn-secondary"
            disabled={isPending}
            onClick={(e) => {
              e.stopPropagation();
              onRequestChanges();
            }}
          >
            <RotateCcw width={14} height={14} /> Request changes
          </button>
          <button
            className="krowe-opd-btn krowe-opd-btn-primary"
            disabled={isPending}
            onClick={handleApprove}
          >
            <Check width={15} height={15} strokeWidth={2.25} />
            {isPending ? "Approving…" : "Approve"}
          </button>
        </div>
      </div>
      <ContextMenu state={menu.state} items={items} onClose={menu.close} />
    </div>
  );
}

/* ── In-progress card ── */
function ProgressCard({
  task,
  builderFirst,
  onSelect,
  onDelete,
}: {
  task: Task;
  builderFirst: string;
  onSelect: () => void;
  onDelete: () => Promise<void>;
}) {
  const { menu, items } = useTaskMenu({ task, role: "operator", onOpen: onSelect, onDelete });

  const subs = task.task_subtasks ?? [];
  const done = subs.filter((s) => s.completed).length;
  const pct = subs.length ? Math.round((done / subs.length) * 100) : 0;
  const estimate = formatHoursRange(
    task.builder_estimate_low_hours,
    task.builder_estimate_high_hours,
    task.builder_estimate_hours
  );
  const added = new Date(task.created_at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  return (
    <div
      className={`krowe-opd-card priority-${task.priority}`}
      onClick={onSelect}
      onContextMenu={menu.openAtEvent}
    >
      <div className="krowe-rail" />
      <div className="krowe-opd-card-body">
        <div className="krowe-opd-card-top">
          <div className="krowe-opd-card-title">{task.title}</div>
          <span className={`krowe-chip krowe-chip-priority ${task.priority}`}>
            {PRIORITY_LABELS[task.priority]}
          </span>
        </div>
        {task.description && <p className="krowe-opd-card-desc clamp">{task.description}</p>}

        {subs.length > 0 && (
          <div className="krowe-opd-prog">
            <div className="krowe-opd-prog-bar">
              <div className="krowe-opd-prog-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="krowe-opd-prog-label">
              {done}/{subs.length} subtasks
            </span>
          </div>
        )}

        <div className="krowe-opd-card-meta">
          <span className="krowe-opd-live">
            <span className="dot" />
            {builderFirst} is on it
          </span>
          <TaskTypeBadge type={task.type} />
          <TaskTags tags={task.tags} />
          <span className="grow" />
          <span className="krowe-opd-eta">
            <Clock width={11} height={11} />
            {estimate ? `~${estimate}` : `Added ${added}`}
          </span>
        </div>
      </div>
      <ContextMenu state={menu.state} items={items} onClose={menu.close} />
    </div>
  );
}

/* ── Up-next condensed row ── */
function UpNextRow({
  task,
  onSelect,
  onDelete,
}: {
  task: Task;
  onSelect: () => void;
  onDelete: () => Promise<void>;
}) {
  const { menu, items } = useTaskMenu({ task, role: "operator", onOpen: onSelect, onDelete });

  return (
    <div
      className={`krowe-opd-row priority-${task.priority}`}
      onClick={onSelect}
      onContextMenu={menu.openAtEvent}
    >
      <div className="krowe-rail" />
      <span
        className={`krowe-opd-dot ${task.priority}`}
        title={PRIORITY_LABELS[task.priority]}
      >
        <span className="d" />
      </span>
      <span className="krowe-opd-row-title">{task.title}</span>
      {task.tags.length > 0 ? <TaskTags tags={task.tags} /> : <TaskTypeBadge type={task.type} />}
      <ContextMenu state={menu.state} items={items} onClose={menu.close} />
    </div>
  );
}

export function OperatorTaskList({ tasks, currentUserId, builderName }: OperatorTaskListProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("task"));
  const [changesTask, setChangesTask] = useState<Task | null>(null);
  // Snapshotted once per mount — the "shipped this week" window doesn't need
  // to move while the page is open, and render purity requires a stable value.
  const [weekAgo] = useState(() => Date.now() - 7 * 86_400_000);
  const [confirm, confirmDialog] = useConfirm();

  const selectedTask = tasks.find((t) => t.id === selectedId) ?? null;
  const builderFirst = builderName?.split(/\s+/)[0] ?? "Your builder";
  const builderFull = builderName ?? "your builder";

  function syncSelected(id: string | null) {
    setSelectedId(id);
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("task", id); else params.delete("task");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function makeDelete(task: Task) {
    return async () => {
      if (
        !(await confirm({
          title: `Delete “${task.title}”?`,
          description: "This permanently removes the task. This can’t be undone.",
          confirmText: "Delete task",
          cancelText: "Cancel",
          icon: Trash2,
          tone: "danger",
        }))
      )
        return;
      deleteTask(task.id).then(() => router.refresh());
    };
  }

  if (tasks.length === 0) {
    return (
      <div className="krowe-column-empty" style={{ maxWidth: 400, margin: "0 auto" }}>
        Nothing here yet — your builder hasn&apos;t shared any tasks.
      </div>
    );
  }

  const review = tasks
    .filter(isAwaitingApproval)
    .sort(
      (a, b) => +new Date(b.approval_sent_at ?? 0) - +new Date(a.approval_sent_at ?? 0)
    );
  const progress = sortByPriority(
    tasks.filter((t) => t.status === "in_progress" && !isAwaitingApproval(t))
  );
  const upNext = sortByPriority(
    tasks.filter(
      (t) => (t.status === "backlog" || t.status === "todo") && !isAwaitingApproval(t)
    )
  );
  const shipped = tasks.filter(
    (t) => t.status === "done" && +new Date(t.completed_at ?? t.updated_at) >= weekAgo
  ).length;

  return (
    <PlainEnglishProvider>
      <div className="krowe-opd-stats">
        <StatTile
          icon={Inbox}
          cls="review"
          num={review.length}
          label="Awaiting your review"
          hot={review.length > 0}
        />
        <StatTile icon={Hammer} cls="progress" num={progress.length} label="In progress" />
        <StatTile icon={Layers} cls="next" num={upNext.length} label="Up next" />
        <StatTile icon={CheckCircle2} cls="ship" num={shipped} label="Shipped this week" />
      </div>

      <div className="krowe-opd-grid">
        <Panel
          icon={Inbox}
          cls="review"
          title="Ready for your review"
          count={review.length}
          hot={review.length > 0}
          note="Needs your sign-off before it ships."
        >
          {review.length === 0 ? (
            <EmptyState
              title="Nothing waiting on you"
              sub="Submitted work lands here for approval."
            />
          ) : (
            review.map((task) => (
              <ReviewCard
                key={task.id}
                task={task}
                builderFirst={builderFirst}
                builderFull={builderFull}
                onSelect={() => syncSelected(task.id)}
                onDelete={makeDelete(task)}
                onRequestChanges={() => setChangesTask(task)}
              />
            ))
          )}
        </Panel>

        <div className="krowe-opd-stack">
          <Panel
            icon={Hammer}
            cls="progress"
            title={builderName ? `What ${builderFirst}'s working on` : "In progress"}
            count={progress.length}
            note="Live from your builder — no need to check in."
          >
            {progress.length === 0 ? (
              <EmptyState
                title={`${builderFirst}'s between tasks`}
                sub="Send something over from Up next."
              />
            ) : (
              progress.map((task) => (
                <ProgressCard
                  key={task.id}
                  task={task}
                  builderFirst={builderFirst}
                  onSelect={() => syncSelected(task.id)}
                  onDelete={makeDelete(task)}
                />
              ))
            )}
          </Panel>

          <Panel
            icon={Layers}
            cls="next"
            title="Up next"
            count={upNext.length}
            note="Queued, not started yet."
          >
            {upNext.length === 0 ? (
              <EmptyState title="Backlog's clear" sub="Add the next thing with the + button." />
            ) : (
              <div className="krowe-opd-rows">
                {upNext.map((task) => (
                  <UpNextRow
                    key={task.id}
                    task={task}
                    onSelect={() => syncSelected(task.id)}
                    onDelete={makeDelete(task)}
                  />
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>

      <TaskDetailSheet
        task={selectedTask}
        role="operator"
        currentUserId={currentUserId}
        onOpenChange={(open) => !open && syncSelected(null)}
      />
      <RequestChangesDialog
        open={!!changesTask}
        onOpenChange={(open) => !open && setChangesTask(null)}
        task={changesTask}
        builderName={builderFull}
        onSaved={() => {
          setChangesTask(null);
          router.refresh();
        }}
      />
      {confirmDialog}
    </PlainEnglishProvider>
  );
}
