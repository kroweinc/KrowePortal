"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlignLeft,
  ArrowRight,
  Check,
  GitBranch,
  Info,
  Link2,
  Paperclip,
  RotateCcw,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import { TaskAuditLog } from "@/components/task-audit-log";
import { TaskBuildPrompt } from "@/components/task-build-prompt";
import { TaskCommits } from "@/components/task-commits";
import { TaskBranchField } from "@/components/task-branch-field";
import { TaskStagingField } from "@/components/task-staging-field";
import type { PreloadedBranches } from "@/lib/actions/get-engagement-branches";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { DeleteTaskButton } from "@/components/delete-task-button";
import {
  InlineText,
  InlineTextarea,
  InlineSelect,
  InlineEstimate,
} from "@/components/inline-edit";
import { approveTask, updateTask, updateTaskStatus } from "@/lib/actions/tasks";
import { useRequestDone } from "@/components/done-deliverable-provider";
import { useRequestApproval } from "@/components/approval-deliverable-provider";
import { TaskAttachments } from "@/components/task-attachments";
import { TaskSubtasks } from "@/components/task-subtasks";
import { TaskRegenerate } from "@/components/task-regenerate";
import { useTaskView, usePlainEnglish } from "@/components/plain-english-context";
import { PlainEnglishToggle } from "@/components/plain-english-toggle";
import { TaskTags } from "@/components/task-type-badge";
import {
  TASK_TYPE_OPTIONS,
  getTaskAdvance,
  getActiveChangeRequest,
  relativeTime,
  submitterName,
} from "@/lib/utils";
import type { Task, Role, TaskStatus, StagingGroup } from "@/lib/types";

const PRIORITY_OPTIONS = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const STATUS_FLOW: { value: TaskStatus; label: string }[] = [
  { value: "backlog", label: "Backlog" },
  { value: "todo", label: "To-Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "done", label: "Done" },
];

function statusIndex(s: TaskStatus) {
  return STATUS_FLOW.findIndex((x) => x.value === s);
}

function statusLabel(s: TaskStatus) {
  return STATUS_FLOW.find((x) => x.value === s)?.label ?? s;
}

function formatTaskId(id: string) {
  const tail = id.replace(/-/g, "").slice(-4).toUpperCase();
  return `KRW-${tail || "TASK"}`;
}

interface TaskDetailSheetProps {
  task: Task | null;
  role: Role;
  currentUserId: string;
  engagementTitle?: string;
  onOpenChange: (open: boolean) => void;
  // Cached repo branches keyed by engagement id, so the deliverable branch
  // chips paint with no fetch. Staging groups likewise, for the group field.
  branchesByEngagement?: Record<string, PreloadedBranches>;
  stagingGroupsByEngagement?: Record<string, StagingGroup[]>;
}

export function TaskDetailSheet({
  task,
  role,
  currentUserId,
  engagementTitle,
  onOpenChange,
  branchesByEngagement,
  stagingGroupsByEngagement,
}: TaskDetailSheetProps) {
  return (
    <Sheet open={!!task} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="krowe-task-sheet"
        showCloseButton={false}
      >
        {task && (
          <TaskDetailBody
            task={task}
            role={role}
            currentUserId={currentUserId}
            engagementTitle={engagementTitle}
            onOpenChange={onOpenChange}
            branchesByEngagement={branchesByEngagement}
            stagingGroupsByEngagement={stagingGroupsByEngagement}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

interface TaskDetailBodyProps {
  task: Task;
  role: Role;
  currentUserId: string;
  engagementTitle?: string;
  onOpenChange: (open: boolean) => void;
  branchesByEngagement?: Record<string, PreloadedBranches>;
  stagingGroupsByEngagement?: Record<string, StagingGroup[]>;
}

function TaskDetailBody({
  task,
  role,
  currentUserId,
  engagementTitle,
  onOpenChange,
  branchesByEngagement,
  stagingGroupsByEngagement,
}: TaskDetailBodyProps) {
  const router = useRouter();
  const requestDone = useRequestDone();
  const requestApproval = useRequestApproval();
  const view = useTaskView(task);
  const { enabled: plainEnabled, ensureTaskCached } = usePlainEnglish();
  const showSimplified = role === "operator" && view.simplified;
  const displayTitle = showSimplified ? view.title : task.title;
  const displayDescription = showSimplified
    ? view.description ?? ""
    : task.description ?? "";

  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "build" | "audit">("overview");
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    setTab("overview");
  }, [task.id]);

  useEffect(() => {
    if (role !== "operator") return;
    if (!plainEnabled) return;
    ensureTaskCached(task);
  }, [role, plainEnabled, task, ensureTaskCached]);

  async function saveField(field: string, value: string) {
    const fd = new FormData();
    fd.set("id", task.id);
    fd.set(field, value);
    await updateTask(fd);
  }

  async function saveEstimate(hours: number) {
    // Same path as priority/type — updateTask collapses the AI low/high range
    // onto this midpoint so the cell reflects the entered value.
    await saveField("builder_estimate_hours", String(hours));
  }

  async function saveStatus(value: TaskStatus) {
    if (value === task.status) return;
    if (value === "done" && task.status !== "done") {
      return new Promise<void>((resolve) => {
        requestDone({
          task,
          onCommit: () => {
            setToast(`Moved to ${statusLabel(value)}`);
            router.refresh();
            resolve();
          },
          onCancel: resolve,
        });
      });
    }
    const result = await updateTaskStatus(task.id, value);
    if (result && "error" in result) {
      setToast(result.error || "Couldn't update status");
      return;
    }
    setToast(`Moved to ${statusLabel(value)}`);
    router.refresh();
  }

  // Operators don't drive the pipeline — they only sign off on work the builder
  // sent for approval.
  const awaitingApproval =
    role === "operator" && !!task.approval_sent_at && !task.approval_approved_at;

  async function handleApprove() {
    const result = await approveTask(task.id);
    if (result && "error" in result) {
      setToast(result.error || "Couldn't approve");
      return;
    }
    setToast("Approved");
    router.refresh();
  }

  async function handleCopyLink() {
    if (typeof window === "undefined") return;
    try {
      await navigator.clipboard.writeText(window.location.href);
      setToast("Link copied");
    } catch {
      setToast("Couldn't copy link");
    }
  }

  // Approval-aware forward step: in_progress advances to the approval dialog
  // first, then (once sent) to Done — mirrors the card's advance button.
  const advance = getTaskAdvance(task);
  const changeRequest = getActiveChangeRequest(task);
  const deliverableAttachments = (task.task_attachments ?? []).filter(
    (a) => a.is_deliverable,
  );
  const hasDeliverable = task.status === "done";
  const hasDeliverableSummary =
    task.pushed_to_main || task.completion_note || deliverableAttachments.length > 0;

  return (
    <>
      {/* Hidden a11y title + description (visible title is the editorial h1 in the hero) */}
      <SheetTitle className="sr-only">{displayTitle || "Task detail"}</SheetTitle>
      <SheetDescription className="sr-only">
        Task details and status controls
      </SheetDescription>

      {/* ── Sticky topbar ── */}
      <div className="krowe-task-sheet-topbar">
        <div className="krowe-task-crumb">
          <span className="id">{formatTaskId(task.id)}</span>
          {engagementTitle && (
            <>
              <span className="sep">/</span>
              <span className="engage" title={engagementTitle}>
                {engagementTitle}
              </span>
            </>
          )}
        </div>
        <div className="krowe-task-sheet-actions">
          <button
            type="button"
            className="krowe-task-iconbtn"
            title="Copy link"
            onClick={handleCopyLink}
          >
            <Link2 className="h-4 w-4" />
          </button>
          <SheetClose asChild>
            <button type="button" className="krowe-task-iconbtn" title="Close">
              <X className="h-4 w-4" />
            </button>
          </SheetClose>
        </div>
      </div>

      {/* ── Tabs strip ── */}
      <div className="krowe-task-sheet-tabs">
        <button
          type="button"
          className={`krowe-task-tab ${tab === "overview" ? "active" : ""}`}
          onClick={() => setTab("overview")}
        >
          Overview
        </button>
        {role !== "operator" && (
          <button
            type="button"
            className={`krowe-task-tab ${tab === "build" ? "active" : ""}`}
            onClick={() => setTab("build")}
          >
            Build
          </button>
        )}
        {role === "operator" && (
          <button
            type="button"
            className={`krowe-task-tab ${tab === "audit" ? "active" : ""}`}
            onClick={() => setTab("audit")}
          >
            Audit Log
          </button>
        )}
      </div>

      {/* ── Scrollable body ── */}
      <div className="krowe-task-sheet-body">
        {tab === "audit" && role === "operator" ? (
          <TaskAuditLog taskId={task.id} />
        ) : tab === "build" && role !== "operator" ? (
          <TaskBuildPrompt task={task} />
        ) : (
        <>
        {/* HERO */}
        <header className="krowe-task-hero">
          <div className="krowe-task-hero-top">
            <span className={`krowe-status-pill ${task.status}`}>
              <span className="pulse" aria-hidden />
              {statusLabel(task.status)}
            </span>
            <span className={`krowe-prio-dot ${task.priority}`}>
              <span className="d" aria-hidden />
              {task.priority} priority
            </span>
          </div>

          <h1 className="krowe-task-hero-title">
            <span className="krowe-task-hero-title-text">
              <InlineText
                value={displayTitle}
                onSave={(v) => saveField("title", v)}
                readOnly={role === "operator"}
                placeholder="Untitled task"
                className="krowe-hero-inline-title"
              />
            </span>
            {showSimplified && (
              <span
                title="Rewritten in plain English"
                className="mt-2 inline-flex shrink-0 items-center text-violet-500"
              >
                <Sparkles className="h-4 w-4" />
              </span>
            )}
          </h1>
        </header>

        {/* STATUS PIPELINE */}
        <StatusPipeline status={task.status} role={role} onChange={saveStatus} />

        {/* Operator-only plain-English control */}
        {role === "operator" && (
          <div className="-mt-1">
            <PlainEnglishToggle />
          </div>
        )}

        {/* CHANGES REQUESTED — operator sent the deliverable back; stays visible
            until the builder re-submits for approval */}
        {changeRequest && (
          <section className="krowe-task-section">
            <div className="krowe-task-section-h">
              <span className="label">
                <RotateCcw className="h-3 w-3" />
                Changes requested
              </span>
            </div>
            <div className="krowe-changes-block">
              <p className="krowe-changes-head">
                <strong>{changeRequest.actor?.display_name ?? "The operator"}</strong>{" "}
                sent this back {relativeTime(changeRequest.created_at)}
              </p>
              {changeRequest.metadata?.note && (
                <p className="krowe-changes-note">&ldquo;{changeRequest.metadata.note}&rdquo;</p>
              )}
              {role === "builder" && (
                <p className="krowe-changes-hint">
                  Make the updates, then send it for approval again.
                </p>
              )}
            </div>
          </section>
        )}

        {/* DESCRIPTION */}
        <section className="krowe-task-section">
          <div className="krowe-task-section-h">
            <span className="label">
              <AlignLeft className="h-3 w-3" />
              Description
            </span>
          </div>
          <div className="krowe-task-desc">
            <InlineTextarea
              value={displayDescription}
              onSave={(v) => saveField("description", v)}
              readOnly={role === "operator"}
              placeholder="No description"
              className="krowe-desc-inline-text"
            />
          </div>
        </section>

        {/* REGENERATE — builder-only: rewrite the task (and reconcile its
            subtasks) from a change note, with a preview before it's applied */}
        {role !== "operator" && (
          <section className="krowe-task-section">
            <div className="krowe-task-section-h">
              <span className="label">
                <WandSparkles className="h-3 w-3" />
                Regenerate
              </span>
            </div>
            <TaskRegenerate
              key={`regen-${task.id}`}
              taskId={task.id}
              onApplied={() => router.refresh()}
            />
          </section>
        )}

        {/* DELIVERABLE (status === done) */}
        {hasDeliverable && (
          <section className="krowe-task-section">
            <div className="krowe-task-section-h">
              <span className="label">
                <GitBranch className="h-3 w-3" />
                Deliverable
              </span>
            </div>
            {hasDeliverableSummary && (task.pushed_to_main || task.completion_note) && (
              <div className="krowe-deliverable-block">
                {task.pushed_to_main && (
                  <div className="krowe-deliverable-pill">
                    <GitBranch className="h-3.5 w-3.5" />
                    Pushed to main
                  </div>
                )}
                {task.completion_note && (
                  <p className="krowe-deliverable-note">{task.completion_note}</p>
                )}
              </div>
            )}
            <TaskBranchField
              key={`branch-${task.id}`}
              taskId={task.id}
              branch={task.branch_name}
              readOnly={role === "operator"}
              preloaded={
                task.engagement_id
                  ? branchesByEngagement?.[task.engagement_id]
                  : undefined
              }
            />
            {task.engagement_id && (
              <TaskStagingField
                key={`staging-${task.id}`}
                taskId={task.id}
                engagementId={task.engagement_id}
                groupId={task.staging_group_id}
                groupName={task.staging_group?.name ?? null}
                readOnly={role === "operator"}
                groups={stagingGroupsByEngagement?.[task.engagement_id]}
              />
            )}
            <TaskCommits
              key={`commits-${task.id}`}
              taskId={task.id}
              canUnlink={role === "builder"}
            />
            {deliverableAttachments.length > 0 && (
              <TaskAttachments
                key={`deliverable-attachments-${task.id}`}
                taskId={task.id}
                role={role}
                currentUserId={currentUserId}
                initial={[]}
                isDeliverable={true}
                readOnly={true}
              />
            )}
          </section>
        )}

        {/* META */}
        <section className="krowe-task-section">
          <div className="krowe-task-section-h">
            <span className="label">
              <Info className="h-3 w-3" />
              Details
            </span>
          </div>
          <MetaCard
            task={task}
            role={role}
            onPriority={(v) => saveField("priority", v)}
            onType={(v) => saveField("type", v)}
            onEstimate={saveEstimate}
          />
        </section>

        {/* ATTACHMENTS */}
        <section className="krowe-task-section">
          <div className="krowe-task-section-h">
            <span className="label">
              <Paperclip className="h-3 w-3" />
              Attachments
            </span>
          </div>
          <div className="krowe-attach-frame">
            <TaskAttachments
              key={`attachments-${task.id}`}
              taskId={task.id}
              role={role}
              currentUserId={currentUserId}
              initial={[]}
              isDeliverable={false}
            />
          </div>
        </section>

        {/* SUBTASKS */}
        <section className="krowe-task-section">
          <div className="krowe-subs-card">
            <TaskSubtasks key={`subtasks-${task.id}`} taskId={task.id} task={task} />
          </div>
        </section>
        </>
        )}
      </div>

      {/* ── Sticky footer ── */}
      <footer className="krowe-task-sheet-footer">
        <DeleteTaskButton
          taskId={task.id}
          taskTitle={task.title}
          variant="ghost"
          onSuccess={() => onOpenChange(false)}
        />
        {role === "operator"
          ? awaitingApproval && (
              <button
                type="button"
                className="krowe-btn-pill primary"
                onClick={handleApprove}
              >
                <Check className="h-3.5 w-3.5" />
                Approve deliverable
              </button>
            )
          : advance && (
              <button
                type="button"
                className="krowe-btn-pill primary"
                onClick={() => {
                  if (advance.kind === "approval") {
                    requestApproval({
                      task,
                      onCommit: () => {
                        setToast("Sent for approval");
                        router.refresh();
                      },
                    });
                  } else {
                    saveStatus(advance.kind === "done" ? "done" : advance.status);
                  }
                }}
              >
                <ArrowRight className="h-3.5 w-3.5" />
                {advance.kind === "approval"
                  ? "Send for approval"
                  : `Move to ${advance.label}`}
              </button>
            )}
      </footer>

      {toast && <div className="krowe-toast">{toast}</div>}
    </>
  );
}

function StatusPipeline({
  status,
  role,
  onChange,
}: {
  status: TaskStatus;
  role: Role;
  onChange: (s: TaskStatus) => void;
}) {
  const active = statusIndex(status);
  // Operators don't drive the pipeline — for them it's a read-only status
  // indicator. Their only task action is "Approve deliverable" in the footer.
  const interactive = role !== "operator";
  return (
    <div className="krowe-pipeline" role="group" aria-label="Task status">
      {STATUS_FLOW.map((s, i) => {
        const cls = i < active ? "done" : i === active ? "active" : "";
        return (
          <button
            key={s.value}
            type="button"
            className={`krowe-pipe-step ${cls}`}
            onClick={interactive ? () => onChange(s.value) : undefined}
            aria-pressed={i === active}
            style={interactive ? undefined : { cursor: "default", pointerEvents: "none" }}
          >
            <span className="num">{String(i + 1).padStart(2, "0")}</span>
            <span className="lbl">{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function MetaCard({
  task,
  role,
  onPriority,
  onType,
  onEstimate,
}: {
  task: Task;
  role: Role;
  onPriority: (v: string) => Promise<void>;
  onType: (v: string) => Promise<void>;
  onEstimate: (hours: number) => Promise<void>;
}) {
  // Legacy/unclassified tasks have no type yet — offer an "Untyped" placeholder
  // so the read-only operator view and the builder's select both render cleanly.
  const typeOptions = task.type
    ? TASK_TYPE_OPTIONS
    : [{ value: "", label: "Untyped" }, ...TASK_TYPE_OPTIONS];
  return (
    <div className="krowe-meta-card">
      <div className="krowe-meta-cell">
        <span className="k">Type</span>
        <span className="v">
          <InlineSelect
            value={task.type ?? ""}
            options={typeOptions}
            onSave={onType}
            readOnly={role === "operator"}
          />
        </span>
      </div>

      <div className="krowe-meta-cell">
        <span className="k">Priority</span>
        <span className="v">
          <InlineSelect
            value={task.priority}
            options={PRIORITY_OPTIONS}
            onSave={onPriority}
            readOnly={role === "operator"}
          />
        </span>
      </div>

      <div className="krowe-meta-cell">
        <span className="k">Estimate</span>
        <span className="v mono">
          <InlineEstimate
            low={task.builder_estimate_low_hours}
            high={task.builder_estimate_high_hours}
            fallback={task.builder_estimate_hours}
            onSave={onEstimate}
            readOnly={role === "operator"}
          />
        </span>
      </div>

      <div className="krowe-meta-cell">
        <span className="k">Submitted by</span>
        <span className="v">{submitterName(task.creator)}</span>
      </div>

      <div className="krowe-meta-cell">
        <span className="k">Added</span>
        <span className="v mono muted">
          {new Date(task.created_at).toLocaleDateString()}
        </span>
      </div>

      {task.tags.length > 0 && (
        <div className="krowe-meta-cell" style={{ gridColumn: "1 / -1" }}>
          <span className="k">Labels</span>
          <span className="v" style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            <TaskTags tags={task.tags} />
          </span>
        </div>
      )}
    </div>
  );
}
