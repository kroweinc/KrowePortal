"use client";

import { useEffect, useMemo, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlignLeft,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  GitBranch,
  History,
  Info,
  Link2,
  MessageSquare,
  Pencil,
  RotateCcw,
  Shapes,
  SignalHigh,
  Sparkles,
  Tag,
  Timer,
  WandSparkles,
  X,
  type LucideIcon,
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
import { commitDoneDeliverable } from "@/lib/tasks/commit-done-deliverable";
import { useRequestDone } from "@/components/done-deliverable-provider";
import { useRequestApproval } from "@/components/approval-deliverable-provider";
import { TaskAttachments } from "@/components/task-attachments";
import {
  TaskCommentsProvider,
  TaskCommentThread,
  TaskDiscussionSection,
  TaskCommentCount,
} from "@/components/task-comments";
import { TaskSubtasks } from "@/components/task-subtasks";
import { MeetingPanel, MeetingPanelSkeleton } from "@/components/granola/meeting-panel";
import { getGranolaMeeting } from "@/lib/actions/granola-meetings";
import type { GranolaMeetingDetail } from "@/lib/actions/granola-meetings";
import { formatCallDate } from "@/lib/granola/format";
import { TaskRegenerate } from "@/components/task-regenerate";
import { useTaskView, usePlainEnglish } from "@/components/plain-english-context";
import { PlainEnglishToggle } from "@/components/plain-english-toggle";
import { ApprovalPill } from "@/components/approval-pill";
import { PriorityBars } from "@/components/design-atoms";
import { SubmitterAvatar } from "@/components/submitter-avatar";
import {
  TaskTags,
  TaskTypeBadge,
  WorkKindBadge,
  TASK_TYPE_ICONS,
  WORK_KIND_ICONS,
} from "@/components/task-type-badge";
import {
  TASK_TYPE_OPTIONS,
  getTaskAdvance,
  getActiveChangeRequest,
  isCodeWork,
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

/** Split a description into the lines the read view bullets.
 *
 *  Descriptions arrive two ways: hand-written with real line breaks (often
 *  already bulleted), or as one AI-generated paragraph of two or three
 *  sentences. Honour explicit lines when they exist, otherwise break on
 *  sentence boundaries — a period followed by a capital or an opening quote,
 *  which leaves "e.g." and decimals alone. */
function descriptionLines(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const lines = trimmed
    .split(/\r?\n+/)
    .map((l) => l.replace(/^\s*(?:[-•*]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
  if (lines.length > 1) return lines;
  return (lines[0] ?? "").split(/(?<=\.)\s+(?=[A-Z“"'])/).filter(Boolean);
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
  // On-screen order of the sibling tasks + a jump callback, so the sheet can
  // step to the previous/next task (‹ › buttons and ↑/↓ keys) without closing.
  siblingIds?: string[];
  onNavigate?: (id: string) => void;
}

export function TaskDetailSheet({
  task,
  role,
  currentUserId,
  engagementTitle,
  onOpenChange,
  branchesByEngagement,
  stagingGroupsByEngagement,
  siblingIds,
  onNavigate,
}: TaskDetailSheetProps) {
  // The board clears `task` (and with it the engagement title) the moment the
  // sheet closes, but Radix keeps the panel mounted through its exit animation
  // — rendering off the live props would slide an empty panel off screen. Hold
  // the last pair until it's gone.
  const [last, setLast] = useState({ task, engagementTitle });
  if (task && (task !== last.task || engagementTitle !== last.engagementTitle)) {
    setLast({ task, engagementTitle });
  }
  const shown = task ?? last.task;
  const shownTitle = task ? engagementTitle : last.engagementTitle;

  return (
    <Sheet open={!!task} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="krowe-task-sheet"
        showCloseButton={false}
        // Escape inside a field cancels that edit and nothing more. Radix listens
        // for Escape in the capture phase on the document, so a field can't stop
        // the sheet from closing on its own — it has to be waved off here, and
        // preventDefault leaves the keypress free to reach the field itself.
        onEscapeKeyDown={(e) => {
          const active = document.activeElement;
          if (active instanceof HTMLElement && active.closest("input, textarea, [contenteditable='true']")) {
            e.preventDefault();
          }
        }}
      >
        {shown && (
          <TaskDetailBody
            task={shown}
            role={role}
            currentUserId={currentUserId}
            engagementTitle={shownTitle}
            onOpenChange={onOpenChange}
            branchesByEngagement={branchesByEngagement}
            stagingGroupsByEngagement={stagingGroupsByEngagement}
            siblingIds={siblingIds}
            onNavigate={onNavigate}
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
  siblingIds?: string[];
  onNavigate?: (id: string) => void;
}

function TaskDetailBody({
  task,
  role,
  currentUserId,
  engagementTitle,
  onOpenChange,
  branchesByEngagement,
  stagingGroupsByEngagement,
  siblingIds,
  onNavigate,
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
  const descriptionBullets = useMemo(
    () => descriptionLines(displayDescription),
    [displayDescription],
  );

  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "comments" | "build" | "audit">("overview");
  // "From meeting" reads the call here first — a sub-view over the whole body,
  // not a tab, because it belongs to one property row rather than to the task.
  // The fetched call is held out here (not in the panel) so stepping back to
  // the task and in again is free.
  const [meetingOpen, setMeetingOpen] = useState(false);
  const [meetingState, setMeetingState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "ready"; meeting: GranolaMeetingDetail }
    | { status: "error" }
  >({ status: "idle" });
  // The description reads as flat prose, so its edit affordance is the Edit
  // button in the section head rather than a box around the text.
  const [editingDesc, setEditingDesc] = useState(false);
  // Optimistic status drives the pipeline + hero pill so a move paints on click
  // instead of waiting on the server action and the router.refresh() that
  // follows it. Resets to task.status once the refresh brings the real value.
  const [optimisticStatus, setOptimisticStatus] = useOptimistic(task.status);
  const [, startStatusTransition] = useTransition();
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    setTab("overview");
    setEditingDesc(false);
    setMeetingOpen(false);
    setMeetingState({ status: "idle" });
  }, [task.id]);

  // Builder-only: /b/meetings is a builder route, and granola_imports_select
  // never matches an operator, so the embed is null for them anyway.
  const meetingImport = role !== "operator" ? task.granola_import ?? null : null;
  const meetingHref = meetingImport
    ? `/b/meetings/${meetingImport.id}?from=${task.id}`
    : null;

  function openMeeting() {
    if (!meetingImport) return;
    setMeetingOpen(true);
    // One read per task — the snapshot is immutable text, and the panel is
    // re-entered often enough that refetching it would be busywork.
    if (meetingState.status !== "idle") return;
    setMeetingState({ status: "loading" });
    getGranolaMeeting(meetingImport.id).then(
      (meeting) =>
        setMeetingState(meeting ? { status: "ready", meeting } : { status: "error" }),
      () => setMeetingState({ status: "error" }),
    );
  }

  // After a "Try again" — the sheet holds the fetched call, so the action's
  // revalidatePath can't reach it. Swaps in the new copy on arrival without
  // dropping back to the skeleton, and stays quiet on failure: the retry
  // button reports its own outcome.
  function refetchMeeting() {
    if (!meetingImport) return;
    getGranolaMeeting(meetingImport.id).then(
      (meeting) => meeting && setMeetingState({ status: "ready", meeting }),
      () => {},
    );
  }

  // Prev/next stepping through the sibling tasks the board is showing. The ids
  // arrive in on-screen order; a missing/empty list simply disables the arrows.
  const navIndex = siblingIds ? siblingIds.indexOf(task.id) : -1;
  const prevId = navIndex > 0 ? siblingIds![navIndex - 1] : null;
  const nextId =
    navIndex >= 0 && siblingIds && navIndex < siblingIds.length - 1
      ? siblingIds[navIndex + 1]
      : null;
  const total = siblingIds?.length ?? 0;

  useEffect(() => {
    if (!onNavigate) return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      // Don't hijack arrows while the user is typing or a listbox is focused.
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.isContentEditable ||
          el.closest('input, textarea, select, [role="listbox"], [contenteditable="true"]'))
      ) {
        return;
      }
      if ((e.key === "ArrowUp" || e.key === "[") && prevId) {
        e.preventDefault();
        onNavigate!(prevId);
      } else if ((e.key === "ArrowDown" || e.key === "]") && nextId) {
        e.preventDefault();
        onNavigate!(nextId);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onNavigate, prevId, nextId]);

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
    if (value === optimisticStatus) return;
    if (value === "done" && task.status !== "done") {
      // Done goes through the deliverable dialog to collect the branch/note, but
      // once the user hits Save we paint the pipeline "done" optimistically and
      // commit in the background — no waiting on the round-trip + refresh.
      return new Promise<void>((resolve) => {
        requestDone({
          task,
          onSubmit: (payload) => {
            startStatusTransition(async () => {
              setOptimisticStatus("done");
              const res = await commitDoneDeliverable(task, payload);
              if (res.ok) {
                setToast(`Moved to ${statusLabel("done")}`);
                router.refresh();
              }
              resolve();
            });
          },
          onCancel: resolve,
        });
      });
    }
    startStatusTransition(async () => {
      setOptimisticStatus(value);
      const result = await updateTaskStatus(task.id, value);
      if (result && "error" in result) {
        setToast(result.error || "Couldn't update status");
        return;
      }
      setToast(`Moved to ${statusLabel(value)}`);
      router.refresh();
    });
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
  // Non-code work (migration 0089) has no branch and no commits, so the
  // GitHub half of the deliverable stays hidden — an email doesn't ship on a
  // branch. Tasks that were never asked read as code and keep the full block.
  const codeWork = isCodeWork(task);
  const hasDeliverableSummary =
    task.pushed_to_main || task.completion_note || deliverableAttachments.length > 0;

  return (
    <TaskCommentsProvider
      task={task}
      role={role}
      currentUserId={currentUserId}
      onChangesRequested={() => router.refresh()}
    >
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
          {onNavigate && total > 1 && (
            <div className="krowe-task-nav" role="group" aria-label="Move between tasks">
              <button
                type="button"
                className="krowe-task-iconbtn"
                title="Previous task (↑)"
                aria-label="Previous task"
                disabled={!prevId}
                onClick={() => prevId && onNavigate(prevId)}
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <span className="krowe-task-nav-pos" aria-hidden="true">
                {navIndex >= 0 ? navIndex + 1 : "–"}
                <span className="sep">/</span>
                {total}
              </span>
              <button
                type="button"
                className="krowe-task-iconbtn"
                title="Next task (↓)"
                aria-label="Next task"
                disabled={!nextId}
                onClick={() => nextId && onNavigate(nextId)}
              >
                <ChevronDown className="h-4 w-4" />
              </button>
              <span className="krowe-task-nav-div" aria-hidden="true" />
            </div>
          )}
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

      {/* ── Sub-bar (reading the call) or the tabs strip ── */}
      {meetingOpen && meetingHref ? (
        <div className="krowe-task-sheet-subbar">
          <button
            type="button"
            className="krowe-task-subbar-back"
            onClick={() => setMeetingOpen(false)}
          >
            <ChevronLeft className="h-4 w-4" />
            Back to task
          </button>
          <Link href={meetingHref} className="krowe-task-subbar-open">
            Open full page
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : (
      <div className="krowe-task-sheet-tabs">
        <button
          type="button"
          className={`krowe-task-tab ${tab === "overview" ? "active" : ""}`}
          onClick={() => setTab("overview")}
        >
          Overview
        </button>
        <button
          type="button"
          className={`krowe-task-tab ${tab === "comments" ? "active" : ""}`}
          onClick={() => setTab("comments")}
        >
          Comments
          <TaskCommentCount />
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
      )}

      {/* ── Scrollable body ── */}
      <div className="krowe-task-sheet-body">
        {meetingOpen && meetingHref ? (
          meetingState.status === "ready" ? (
            <MeetingPanel
              meeting={meetingState.meeting}
              fromTaskId={task.id}
              onOpenTask={onNavigate}
              openableTaskIds={siblingIds}
              onRefreshed={refetchMeeting}
            />
          ) : meetingState.status === "error" ? (
            <div className="krowe-mtg-note">
              <Info size={17} strokeWidth={2} aria-hidden="true" />
              <p>
                This call couldn&rsquo;t be read here.{" "}
                <Link href={meetingHref} className="krowe-mtg-jump">
                  Open it on its own page
                </Link>
                .
              </p>
            </div>
          ) : (
            <MeetingPanelSkeleton />
          )
        ) : tab === "comments" ? (
          <TaskCommentThread />
        ) : tab === "audit" && role === "operator" ? (
          <TaskAuditLog taskId={task.id} />
        ) : tab === "build" && role !== "operator" ? (
          <TaskBuildPrompt task={task} />
        ) : (
        <>
        {/* HERO — the title leads; status moved down into the stepper and the
            Stage property row, so nothing competes with it at the top. */}
        <header className="krowe-task-hero">
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
          <div className="krowe-task-byline">
            <span className="krowe-card-submitter">
              <SubmitterAvatar creator={task.creator} />
              {submitterName(task.creator)}
            </span>
            <span className="dot" aria-hidden="true" />
            <span>
              opened{" "}
              {new Date(task.created_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                timeZone: "UTC",
              })}
            </span>
            {(task.approval_sent_at || task.approval_approved_at) && (
              <span className="krowe-task-hero-approval">
                <ApprovalPill task={task} role={role} onUnsent={() => router.refresh()} />
              </span>
            )}
          </div>
        </header>

        {/* STATUS PIPELINE */}
        <StatusPipeline status={optimisticStatus} role={role} onChange={saveStatus} />

        {/* Operator-only plain-English control */}
        {role === "operator" && (
          <div className="-mt-1">
            <PlainEnglishToggle />
          </div>
        )}

        {/* PROPERTIES — Linear's right rail, laid flat. Sits directly under the
            stepper so the task's shape reads before its prose. */}
        <TaskProps
          task={task}
          role={role}
          onPriority={(v) => saveField("priority", v)}
          onType={(v) => saveField("type", v)}
          onEstimate={saveEstimate}
          meetingHref={meetingHref}
          onOpenMeeting={openMeeting}
        />

        {/* CHANGES REQUESTED — operator sent the deliverable back; stays visible
            until the builder re-submits for approval */}
        {changeRequest && (
          <section className="krowe-task-section">
            <div className="krowe-task-section-h">
              <span className="label">
                <RotateCcw className="h-3 w-3" />
                Changes requested
              </span>
              <span className="rule" />
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
            <span className="rule" />
            {role !== "operator" && !editingDesc && (
              <button
                type="button"
                className="krowe-task-mini"
                onClick={() => setEditingDesc(true)}
              >
                <Pencil className="h-3 w-3" />
                Edit
              </button>
            )}
          </div>
          {/* Read mode splits the prose into bullets so a multi-clause brief
              scans; editing falls back to the raw textarea, which is what
              actually round-trips to the column. */}
          {!editingDesc && descriptionBullets.length > 0 ? (
            <ul className="krowe-task-bullets">
              {descriptionBullets.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          ) : (
            <div className="krowe-task-desc">
              <InlineTextarea
                value={displayDescription}
                onSave={(v) => saveField("description", v)}
                readOnly={role === "operator"}
                placeholder="No description"
                className="krowe-desc-inline-text"
                editing={editingDesc}
                onEditingChange={setEditingDesc}
              />
            </div>
          )}
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
              <span className="rule" />
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
                {(() => {
                  const Icon = codeWork
                    ? GitBranch
                    : WORK_KIND_ICONS[task.work_kind ?? "other"];
                  return <Icon className="h-3 w-3" />;
                })()}
                Deliverable
              </span>
              <span className="rule" />
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
            {codeWork && (
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
            )}
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
            {codeWork && (
              <TaskCommits
                key={`commits-${task.id}`}
                taskId={task.id}
                canUnlink={role === "builder"}
              />
            )}
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

        {/* ATTACHMENTS — the component draws its own section head (label, rule
            and the Add action together), so the sheet only frames the band. */}
        <section className="krowe-task-section">
          <TaskAttachments
            key={`attachments-${task.id}`}
            taskId={task.id}
            role={role}
            currentUserId={currentUserId}
            initial={[]}
            isDeliverable={false}
          />
        </section>

        {/* SUBTASKS — likewise owns its head (Generate / Add). */}
        <section className="krowe-task-section">
          <TaskSubtasks key={`subtasks-${task.id}`} taskId={task.id} task={task} />
        </section>

        {/* DISCUSSION — the newest message or approval event, and a way into the
            full thread. Renders nothing until the thread has an entry, and
            everything you can write lives in the Comments tab. */}
        <TaskDiscussionSection onOpenThread={() => setTab("comments")} />

        {/* ACTIVITY — the newest few events. Self-fetching, so it sits last in
            the DOM and its request never delays the sheet's first paint. The
            full ledger (digest, filters, day grouping) lives in the Audit tab. */}
        <section className="krowe-task-section">
          <div className="krowe-task-section-h">
            <span className="label">
              <History className="h-3 w-3" />
              Activity
            </span>
            <span className="rule" />
          </div>
          <TaskAuditLog
            key={`activity-${task.id}`}
            taskId={task.id}
            compact
            onViewAll={role === "operator" ? () => setTab("audit") : undefined}
          />
        </section>
        </>
        )}
      </div>

      {/* ── Sticky footer ── Task verbs only, so it stands down while the call
          is on screen; the sub-bar carries that view's own two actions. */}
      {!meetingOpen && (
      <footer className="krowe-task-sheet-footer">
        <DeleteTaskButton
          taskId={task.id}
          taskTitle={task.title}
          variant="ghost"
          onSuccess={() => onOpenChange(false)}
        />
        <span className="krowe-task-sheet-footer-spacer" />
        <button
          type="button"
          className="krowe-btn-pill"
          onClick={() => setTab("comments")}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Comment
        </button>
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
      )}

      {toast && <div className="krowe-toast">{toast}</div>}
    </TaskCommentsProvider>
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
            {/* A cleared stage checks off; the current one wears the same
                half-filled disc the card in that column shows. */}
            <span className="tick" aria-hidden="true">
              {i < active && <Check width={9} height={9} strokeWidth={3.5} />}
            </span>
            <span className="lbl">{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Prop({
  icon: Icon,
  label,
  mono = false,
  wide = false,
  children,
}: {
  icon: LucideIcon;
  label: string;
  mono?: boolean;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`krowe-task-prop ${wide ? "wide" : ""}`}>
      <span className="k">
        <Icon width={14} height={14} strokeWidth={1.9} aria-hidden="true" />
        {label}
      </span>
      <span className={`v ${mono ? "mono" : ""}`}>{children}</span>
    </div>
  );
}

/** Property rows, paired two-up. Each row is self-contained (no positional
 *  :nth-child separators), so rows can be reordered or dropped freely.
 *
 *  Deliberately absent: Stage, Submitted by, Created. All three already read
 *  off the stepper and the byline directly above, and repeating them here was
 *  what made this block nine rows tall. */
function TaskProps({
  task,
  role,
  onPriority,
  onType,
  onEstimate,
  meetingHref,
  onOpenMeeting,
}: {
  task: Task;
  role: Role;
  onPriority: (v: string) => Promise<void>;
  onType: (v: string) => Promise<void>;
  onEstimate: (hours: number) => Promise<void>;
  /** Null when this task didn't come from a call, or for an operator. */
  meetingHref: string | null;
  onOpenMeeting: () => void;
}) {
  // Legacy/unclassified tasks have no type yet — offer an "Untyped" placeholder
  // so the read-only operator view and the builder's select both render cleanly.
  const typeOptions = task.type
    ? TASK_TYPE_OPTIONS
    : [{ value: "", label: "Untyped" }, ...TASK_TYPE_OPTIONS];

  return (
    <div className="krowe-task-props">
      <Prop icon={SignalHigh} label="Priority">
        <PriorityBars priority={task.priority} />
        <InlineSelect
          value={task.priority}
          options={PRIORITY_OPTIONS}
          onSave={onPriority}
          readOnly={role === "operator"}
          label="Priority"
        />
      </Prop>

      {/* The value is the same chip the card wears, so the type reads identically
          in both places; the picker sits transparently over it. */}
      <Prop icon={task.type ? TASK_TYPE_ICONS[task.type] : Shapes} label="Type">
        <InlineSelect
          variant="chip"
          face={
            task.type ? (
              <TaskTypeBadge type={task.type} />
            ) : (
              <span className="krowe-chip krowe-chip-tag">Untyped</span>
            )
          }
          value={task.type ?? ""}
          options={typeOptions}
          onSave={onType}
          readOnly={role === "operator"}
          label="Type"
        />
      </Prop>

      {/* Chosen in the approval dialog, not here — null means the question was
          never asked, so the row stays out rather than claiming "Code". */}
      {task.work_kind && (
        <Prop icon={WORK_KIND_ICONS[task.work_kind]} label="Work">
          <WorkKindBadge kind={task.work_kind} />
        </Prop>
      )}

      <Prop icon={Tag} label="Labels">
        {task.tags.length > 0 ? (
          <TaskTags tags={task.tags} />
        ) : (
          <span className="none">None</span>
        )}
      </Prop>

      <Prop icon={Timer} label="Estimate" mono>
        <InlineEstimate
          low={task.builder_estimate_low_hours}
          high={task.builder_estimate_high_hours}
          fallback={task.builder_estimate_hours}
          onSave={onEstimate}
          readOnly={role === "operator"}
        />
      </Prop>

      {/* From meeting — reads the call in the sheet, one step from the task it
          drafted, and keeps the page as its href so ⌘/middle-click still opens
          it in a tab. Spans both columns: a call title plus its date never fits
          in half a row. */}
      {meetingHref && task.granola_import && (
        <Link
          href={meetingHref}
          className="krowe-task-prop krowe-task-prop-link wide"
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            onOpenMeeting();
          }}
        >
          <span className="k">
            <AudioLines width={14} height={14} strokeWidth={1.9} aria-hidden="true" />
            From meeting
          </span>
          <span className="v">
            <span className="t">
              {task.granola_import.granola_note_title ?? "Untitled call"}
            </span>
            {formatCallDate(task.granola_import.granola_created_at) && (
              <span className="when">
                {formatCallDate(task.granola_import.granola_created_at)}
              </span>
            )}
            <ChevronRight width={14} height={14} strokeWidth={2} className="go" aria-hidden="true" />
          </span>
        </Link>
      )}
    </div>
  );
}
