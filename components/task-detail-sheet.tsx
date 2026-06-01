"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlignLeft,
  ArrowRight,
  GitBranch,
  Info,
  Link2,
  Paperclip,
  Sparkles,
  X,
} from "lucide-react";
import { TaskAuditLog } from "@/components/task-audit-log";
import { TaskBuildPrompt } from "@/components/task-build-prompt";
import { TaskCommits } from "@/components/task-commits";
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
  InlineToggle,
} from "@/components/inline-edit";
import { updateTask, updateTaskStatus, toggleVisibility } from "@/lib/actions/tasks";
import { useRequestDone } from "@/components/done-deliverable-provider";
import { TaskAttachments } from "@/components/task-attachments";
import { TaskSubtasks } from "@/components/task-subtasks";
import { useTaskView, usePlainEnglish } from "@/components/plain-english-context";
import { PlainEnglishToggle } from "@/components/plain-english-toggle";
import type { Task, Role, TaskStatus } from "@/lib/types";
import { formatHoursRange } from "@/lib/format-estimate";

const PRIORITY_OPTIONS = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const STATUS_FLOW: { value: TaskStatus; label: string }[] = [
  { value: "inbox", label: "Inbox" },
  { value: "in_progress", label: "In Progress" },
  { value: "blocked", label: "Approval" },
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
}

export function TaskDetailSheet({
  task,
  role,
  currentUserId,
  engagementTitle,
  onOpenChange,
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
}

function TaskDetailBody({
  task,
  role,
  currentUserId,
  engagementTitle,
  onOpenChange,
}: TaskDetailBodyProps) {
  const router = useRouter();
  const requestDone = useRequestDone();
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
    await updateTaskStatus(task.id, value);
    setToast(`Moved to ${statusLabel(value)}`);
    router.refresh();
  }

  async function saveVisibility(newVisible: boolean) {
    await toggleVisibility(task.id, newVisible);
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

  const currentIndex = statusIndex(task.status);
  const nextStatus = currentIndex >= 0 ? STATUS_FLOW[currentIndex + 1] : undefined;
  const deliverableAttachments = (task.task_attachments ?? []).filter(
    (a) => a.is_deliverable,
  );
  const regularAttachments = (task.task_attachments ?? []).filter(
    (a) => !a.is_deliverable,
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
        <button
          type="button"
          className={`krowe-task-tab ${tab === "audit" ? "active" : ""}`}
          onClick={() => setTab("audit")}
        >
          Audit Log
        </button>
      </div>

      {/* ── Scrollable body ── */}
      <div className="krowe-task-sheet-body">
        {tab === "audit" ? (
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
        <StatusPipeline status={task.status} onChange={saveStatus} />

        {/* Operator-only plain-English control */}
        {role === "operator" && (
          <div className="-mt-1">
            <PlainEnglishToggle />
          </div>
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
                initial={deliverableAttachments}
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
            onVisibility={saveVisibility}
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
              initial={regularAttachments}
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
        {nextStatus && (
          <button
            type="button"
            className="krowe-btn-pill primary"
            onClick={() => saveStatus(nextStatus.value)}
          >
            <ArrowRight className="h-3.5 w-3.5" />
            Move to {nextStatus.label}
          </button>
        )}
      </footer>

      {toast && <div className="krowe-toast">{toast}</div>}
    </>
  );
}

function StatusPipeline({
  status,
  onChange,
}: {
  status: TaskStatus;
  onChange: (s: TaskStatus) => void;
}) {
  const active = statusIndex(status);
  return (
    <div className="krowe-pipeline" role="group" aria-label="Task status">
      {STATUS_FLOW.map((s, i) => {
        const cls = i < active ? "done" : i === active ? "active" : "";
        return (
          <button
            key={s.value}
            type="button"
            className={`krowe-pipe-step ${cls}`}
            onClick={() => onChange(s.value)}
            aria-pressed={i === active}
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
  onVisibility,
}: {
  task: Task;
  role: Role;
  onPriority: (v: string) => Promise<void>;
  onVisibility: (v: boolean) => Promise<void>;
}) {
  const estimateLabel = formatHoursRange(
    task.builder_estimate_low_hours,
    task.builder_estimate_high_hours,
    task.builder_estimate_hours
  );
  return (
    <div className="krowe-meta-card">
      <div className="krowe-meta-cell">
        <span className="k">Source</span>
        <span className="v">
          <span
            className={`krowe-meta-badge ${
              task.source === "operator_request" ? "operator" : "builder"
            }`}
          >
            {task.source === "operator_request"
              ? "Operator requested"
              : "Builder added"}
          </span>
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
        <span className={`v mono${estimateLabel ? "" : " muted"}`}>
          {estimateLabel ?? "—"}
        </span>
      </div>

      <div className="krowe-meta-cell">
        <span className="k">Added</span>
        <span className="v mono muted">
          {new Date(task.created_at).toLocaleDateString()}
        </span>
      </div>

      {role === "builder" && (
        <div className="krowe-meta-cell full">
          <span className="k">Visibility</span>
          <span className="v">
            <InlineToggle
              value={task.operator_visible}
              onToggle={onVisibility}
              trueLabel="Visible to operator"
              falseLabel="Hidden from operator"
              trueBadgeVariant="secondary"
              falseBadgeVariant="outline"
            />
          </span>
        </div>
      )}
    </div>
  );
}
