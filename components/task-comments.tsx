"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  ArrowUp,
  Check,
  MessageSquare,
  Pencil,
  RotateCcw,
  Send,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  addTaskComment,
  editTaskComment,
  deleteTaskComment,
} from "@/lib/actions/task-comments";
import { relativeTime, submitterInitials, submitterName } from "@/lib/utils";
import type { Role, Task, TaskComment } from "@/lib/types";

// The task's conversation, shared by two surfaces: the Comments tab (full
// thread + composer) and the one-row preview on Overview. Both read the same
// provider, so posting in the tab repaints the preview with no refetch.
//
// The thread interleaves two sources — the messages in task_comments and the
// approval-loop events already in task_audit_log — so a formal send-back reads
// as part of the same conversation instead of sitting apart from it.

type ThreadActor = { id: string; display_name: string | null; role: Role };

type ThreadEvent = {
  id: string;
  action: string;
  metadata: { note?: string } | null;
  created_at: string;
  actor: ThreadActor | null;
};

type TimelineEntry =
  | { kind: "comment"; id: string; at: string; comment: TaskComment; pending?: boolean }
  | { kind: "event"; id: string; at: string; event: ThreadEvent };

type TaskCommentsValue = {
  entries: TimelineEntry[];
  commentCount: number;
  loading: boolean;
  error: string | null;
  role: Role;
  currentUserId: string;
  /** Whether the composer offers the "Request a change" toggle — mirrors the
      state requestTaskChanges enforces server-side, so the control can never
      be shown for a task the action would reject. */
  canRequestChanges: boolean;
  post: (body: string, requestChanges: boolean) => Promise<boolean>;
  edit: (commentId: string, body: string) => Promise<boolean>;
  remove: (commentId: string) => Promise<void>;
};

const TaskCommentsContext = createContext<TaskCommentsValue | null>(null);

function useTaskComments(): TaskCommentsValue {
  const ctx = useContext(TaskCommentsContext);
  if (!ctx) throw new Error("useTaskComments must be used within TaskCommentsProvider");
  return ctx;
}

function entryOf(row: TaskComment, pending = false): TimelineEntry {
  return { kind: "comment", id: row.id, at: row.created_at, comment: row, pending };
}

export function TaskCommentsProvider({
  task,
  role,
  currentUserId,
  onChangesRequested,
  children,
}: {
  task: Task;
  role: Role;
  currentUserId: string;
  /** Fired after a comment doubled as a formal send-back, so the sheet can
      refresh the hero pill, pipeline, and changes-requested block. */
  onChangesRequested?: () => void;
  children: ReactNode;
}) {
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [events, setEvents] = useState<ThreadEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const taskId = task.id;

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await fetch(`/api/task-comments?taskId=${encodeURIComponent(taskId)}`, {
          signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (signal?.aborted) return;
        setComments(Array.isArray(data.comments) ? data.comments : []);
        setEvents(Array.isArray(data.events) ? data.events : []);
        setError(null);
      } catch (e: unknown) {
        if (signal?.aborted) return;
        setError(e instanceof Error ? e.message : "Couldn't load the conversation");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [taskId]
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const post = useCallback(
    async (body: string, requestChanges: boolean) => {
      const trimmed = body.trim();
      if (!trimmed) return false;

      // Paint the message immediately under a temporary id, then swap in the
      // server row (or drop it and surface the error).
      const tempId = `pending-${crypto.randomUUID()}`;
      const optimistic: TaskComment = {
        id: tempId,
        task_id: taskId,
        author_id: currentUserId,
        body: trimmed,
        created_at: new Date().toISOString(),
        updated_at: null,
        deleted_at: null,
        author: { id: currentUserId, display_name: null, role },
      };
      setComments((prev) => [...prev, optimistic]);

      const result = await addTaskComment(taskId, trimmed, { requestChanges });

      if (!result.comment) {
        setComments((prev) => prev.filter((c) => c.id !== tempId));
        toast.error(result.error || "Couldn't post that comment");
        return false;
      }

      const saved = result.comment;
      setComments((prev) => prev.map((c) => (c.id === tempId ? saved : c)));

      if (result.error) {
        // The comment landed but the send-back didn't (e.g. the task left the
        // approval state between render and submit). Say so plainly.
        toast.error(result.error);
        return true;
      }

      if (requestChanges) {
        // requestTaskChanges wrote a task.changes_requested entry we don't have
        // locally — pull it in so the thread shows the send-back card.
        startTransition(() => {
          void load();
          onChangesRequested?.();
        });
      }
      return true;
    },
    [taskId, currentUserId, role, load, onChangesRequested]
  );

  const edit = useCallback(async (commentId: string, body: string) => {
    const trimmed = body.trim();
    if (!trimmed) return false;
    const result = await editTaskComment(commentId, trimmed);
    if (!result.comment) {
      toast.error(result.error || "Couldn't save that edit");
      return false;
    }
    const saved = result.comment;
    setComments((prev) => prev.map((c) => (c.id === commentId ? saved : c)));
    return true;
  }, []);

  const remove = useCallback(
    async (commentId: string) => {
      const before = comments;
      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId
            ? { ...c, body: null, deleted_at: new Date().toISOString() }
            : c
        )
      );
      const result = await deleteTaskComment(commentId);
      if (result.error) {
        setComments(before);
        toast.error(result.error);
      }
    },
    [comments]
  );

  const entries = useMemo<TimelineEntry[]>(() => {
    const merged: TimelineEntry[] = [
      ...comments.map((c) => entryOf(c, c.id.startsWith("pending-"))),
      ...events.map<TimelineEntry>((e) => ({
        kind: "event",
        id: e.id,
        at: e.created_at,
        event: e,
      })),
    ];
    return merged.sort((a, b) => a.at.localeCompare(b.at));
  }, [comments, events]);

  const commentCount = useMemo(
    () => comments.filter((c) => !c.deleted_at).length,
    [comments]
  );

  const value = useMemo<TaskCommentsValue>(
    () => ({
      entries,
      commentCount,
      loading,
      error,
      role,
      currentUserId,
      canRequestChanges:
        role === "operator" && !!task.approval_sent_at && !task.approval_approved_at,
      post,
      edit,
      remove,
    }),
    [
      entries,
      commentCount,
      loading,
      error,
      role,
      currentUserId,
      task.approval_sent_at,
      task.approval_approved_at,
      post,
      edit,
      remove,
    ]
  );

  return (
    <TaskCommentsContext.Provider value={value}>{children}</TaskCommentsContext.Provider>
  );
}

// ── Shared row rendering ─────────────────────────────────────────────────────

const EVENT_VERB: Record<string, string> = {
  "task.sent_for_approval": "sent this for approval",
  "task.approval_withdrawn": "pulled this back from approval",
  "task.approved": "approved this",
};

function actorLabel(actor: ThreadActor | null): string {
  return submitterName(actor ?? undefined);
}

function CommentRow({
  entry,
  canManage,
  onEdit,
  onDelete,
  compact = false,
}: {
  entry: Extract<TimelineEntry, { kind: "comment" }>;
  canManage: boolean;
  onEdit?: (body: string) => Promise<boolean>;
  onDelete?: () => void;
  compact?: boolean;
}) {
  const { comment, pending } = entry;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body ?? "");
  const [saving, setSaving] = useState(false);
  const author = comment.author ?? null;
  const removed = !!comment.deleted_at;

  async function save() {
    if (!onEdit) return;
    setSaving(true);
    const ok = await onEdit(draft);
    setSaving(false);
    if (ok) setEditing(false);
  }

  return (
    <li className={`krowe-cm-row ${pending ? "pending" : ""} ${compact ? "compact" : ""}`}>
      <span className={`krowe-cm-avatar ${author?.role ?? "builder"}`} aria-hidden="true">
        {submitterInitials(author ?? undefined)}
      </span>
      <div className="krowe-cm-body">
        <div className="krowe-cm-head">
          <span className="who">{actorLabel(author)}</span>
          {author && <span className={`krowe-role-tag ${author.role}`}>{author.role}</span>}
          <span className="when" title={new Date(comment.created_at).toLocaleString()}>
            {pending ? "sending…" : relativeTime(comment.created_at)}
          </span>
          {comment.updated_at && !removed && <span className="edited">edited</span>}
          {canManage && !removed && !editing && !pending && (
            <span className="krowe-cm-rowactions">
              <button
                type="button"
                aria-label="Edit comment"
                title="Edit"
                onClick={() => {
                  setDraft(comment.body ?? "");
                  setEditing(true);
                }}
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                type="button"
                aria-label="Delete comment"
                title="Delete"
                className="danger"
                onClick={onDelete}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
          )}
        </div>

        {removed ? (
          <p className="krowe-cm-removed">Comment removed</p>
        ) : editing ? (
          <div className="krowe-cm-editbox">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              autoFocus
              disabled={saving}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditing(false);
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
              }}
            />
            <div className="krowe-cm-editactions">
              <button
                type="button"
                className="krowe-cm-send"
                onClick={() => void save()}
                disabled={saving || !draft.trim()}
              >
                <Check className="h-3.5 w-3.5" />
                Save
              </button>
              <button
                type="button"
                className="krowe-cm-ghost"
                onClick={() => setEditing(false)}
                disabled={saving}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className="krowe-cm-text">{comment.body}</p>
        )}
      </div>
    </li>
  );
}

function EventRow({
  entry,
  compact = false,
}: {
  entry: Extract<TimelineEntry, { kind: "event" }>;
  compact?: boolean;
}) {
  const { event } = entry;
  const name = actorLabel(event.actor);
  const when = relativeTime(event.created_at);

  if (event.action === "task.changes_requested") {
    const note = event.metadata?.note;
    return (
      <li className={`krowe-cm-change ${compact ? "compact" : ""}`}>
        <div className="krowe-cm-change-head">
          <RotateCcw className="h-3.5 w-3.5" />
          <strong>{name}</strong> requested changes
          <span className="when">{when}</span>
        </div>
        {note && <p className="krowe-cm-change-note">&ldquo;{note}&rdquo;</p>}
      </li>
    );
  }

  const verb = EVENT_VERB[event.action] ?? event.action.replace(/[._]/g, " ");
  return (
    <li className={`krowe-cm-sys ${compact ? "compact" : ""}`}>
      <span className="rule" aria-hidden="true" />
      <span className="txt">
        {event.action === "task.approved" ? (
          <Check className="h-3 w-3" />
        ) : event.action === "task.approval_withdrawn" ? (
          <Undo2 className="h-3 w-3" />
        ) : (
          <Send className="h-3 w-3" />
        )}
        <strong>{name}</strong> {verb} · {when}
      </span>
      <span className="rule" aria-hidden="true" />
    </li>
  );
}

// ── Comments tab ─────────────────────────────────────────────────────────────

export function TaskCommentThread() {
  const {
    entries,
    loading,
    error,
    role,
    currentUserId,
    canRequestChanges,
    post,
    edit,
    remove,
  } = useTaskComments();

  const [draft, setDraft] = useState("");
  const [requestChanges, setRequestChanges] = useState(false);
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const settledRef = useRef(false);

  // A conversation opens at its most recent message. The first paint jumps;
  // everything after it eases, unless the reader asked for less motion.
  useEffect(() => {
    if (loading || entries.length === 0) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    endRef.current?.scrollIntoView({
      behavior: settledRef.current && !reduce ? "smooth" : "auto",
      block: "nearest",
    });
    settledRef.current = true;
  }, [entries.length, loading]);

  // The toggle only exists while the task is awaiting approval — if it leaves
  // that state mid-compose, drop the flag so the send stays a plain comment.
  useEffect(() => {
    if (!canRequestChanges) setRequestChanges(false);
  }, [canRequestChanges]);

  function grow(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  async function send() {
    if (!draft.trim() || sending) return;
    setSending(true);
    const ok = await post(draft, requestChanges);
    setSending(false);
    if (ok) {
      setDraft("");
      setRequestChanges(false);
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
        textareaRef.current.focus();
      }
    }
  }

  return (
    <div className="krowe-cm">
      <div className="krowe-cm-scroll">
        {loading ? (
          <p className="krowe-cm-empty">Loading the conversation…</p>
        ) : error ? (
          <p className="krowe-cm-empty">Couldn&rsquo;t load the conversation: {error}</p>
        ) : entries.length === 0 ? (
          <div className="krowe-cm-blank">
            <MessageSquare className="h-5 w-5" />
            <p className="head">No comments yet</p>
            <p className="sub">
              {role === "operator"
                ? "Ask a question or leave feedback — your builder sees it here."
                : "Leave a note here and your client picks it up on their board."}
            </p>
          </div>
        ) : (
          <ul className="krowe-cm-list">
            {entries.map((entry) =>
              entry.kind === "comment" ? (
                <CommentRow
                  key={entry.id}
                  entry={entry}
                  canManage={entry.comment.author_id === currentUserId}
                  onEdit={(body) => edit(entry.id, body)}
                  onDelete={() => void remove(entry.id)}
                />
              ) : (
                <EventRow key={entry.id} entry={entry} />
              )
            )}
          </ul>
        )}
        <div ref={endRef} />
      </div>

      <div className={`krowe-field-shell krowe-cm-composer ${requestChanges ? "flagged" : ""}`}>
        <textarea
          ref={textareaRef}
          value={draft}
          rows={1}
          placeholder={
            requestChanges ? "What needs to change?" : "Write a comment…"
          }
          disabled={sending}
          onChange={(e) => {
            setDraft(e.target.value);
            grow(e.target);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            } else if (e.key === "Escape" && draft) {
              e.preventDefault();
              setDraft("");
              if (textareaRef.current) textareaRef.current.style.height = "auto";
            }
          }}
        />
        <div className="krowe-cm-composer-foot">
          {canRequestChanges ? (
            <button
              type="button"
              className={`krowe-cm-flag ${requestChanges ? "on" : ""}`}
              aria-pressed={requestChanges}
              onClick={() => setRequestChanges((v) => !v)}
            >
              <RotateCcw className="h-3 w-3" />
              Request a change
            </button>
          ) : (
            <span className="krowe-cm-hint">⌘↵ to send</span>
          )}
          <button
            type="button"
            className="krowe-cm-send"
            onClick={() => void send()}
            disabled={sending || !draft.trim()}
          >
            {requestChanges ? (
              <>
                <RotateCcw className="h-3.5 w-3.5" />
                {sending ? "Sending…" : "Send & request changes"}
              </>
            ) : (
              <>
                <ArrowUp className="h-3.5 w-3.5" />
                {sending ? "Sending…" : "Send"}
              </>
            )}
          </button>
        </div>
        {requestChanges && (
          <p className="krowe-cm-flag-hint">
            This also sends the task back to In Progress so your builder can pick it up.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Overview preview ─────────────────────────────────────────────────────────

/** The single most recent entry plus a way into the full thread. Read-only —
 *  every write happens in the Comments tab. */
export function TaskCommentPreview({ onOpenThread }: { onOpenThread: () => void }) {
  const { entries, commentCount, loading, error } = useTaskComments();
  const latest = entries[entries.length - 1];

  if (loading) {
    return <div className="krowe-cm-preview loading">Loading the conversation…</div>;
  }

  if (error || !latest) {
    return (
      <div className="krowe-cm-preview">
        <p className="krowe-cm-preview-blank">
          {error ? "Couldn't load the conversation" : "No comments yet"}
        </p>
        <button type="button" className="krowe-cm-open" onClick={onOpenThread}>
          <MessageSquare className="h-3.5 w-3.5" />
          Start the conversation
        </button>
      </div>
    );
  }

  return (
    <div className="krowe-cm-preview">
      <ul className="krowe-cm-list">
        {latest.kind === "comment" ? (
          <CommentRow key={latest.id} entry={latest} canManage={false} compact />
        ) : (
          <EventRow key={latest.id} entry={latest} compact />
        )}
      </ul>
      <button type="button" className="krowe-cm-open" onClick={onOpenThread}>
        <MessageSquare className="h-3.5 w-3.5" />
        {commentCount === 0
          ? "Open the conversation"
          : `View all comments (${commentCount})`}
      </button>
    </div>
  );
}

/** Count badge for the Comments tab — nothing renders until there's something
 *  to count, so an untouched task keeps a clean tab strip. */
export function TaskCommentCount() {
  const { commentCount } = useTaskComments();
  if (commentCount === 0) return null;
  return <span className="krowe-cm-count">{commentCount}</span>;
}
