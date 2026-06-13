"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  Flame,
  GitMerge,
  History,
  PenLine,
  Repeat2,
} from "lucide-react";

type AuditActor = {
  id: string;
  display_name: string | null;
  role: "operator" | "builder";
};

type AuditEntry = {
  id: string;
  action: string;
  field: string | null;
  old_value: unknown;
  new_value: unknown;
  metadata: Record<string, unknown> | null;
  created_at: string;
  subtask_id: string | null;
  actor: AuditActor | null;
};

/** Visual lane each event falls into in the ledger. */
type EventKind = "milestone" | "status" | "subtask" | "note" | "default";

const STATUS_LABEL: Record<string, string> = {
  inbox: "Inbox",
  in_progress: "In Progress",
  blocked: "Approval",
  done: "Done",
};

const PRIORITY_LABEL: Record<string, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const FILTERS: { id: "all" | "status" | "subtask" | "note"; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "status", label: "Status" },
  { id: "subtask", label: "Sub-tasks" },
  { id: "note", label: "Notes" },
];

function actorName(actor: AuditActor | null): string {
  if (!actor) return "Someone";
  if (actor.display_name && actor.display_name.trim().length > 0) {
    return actor.display_name;
  }
  return actor.role === "operator" ? "Operator" : "Builder";
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function classify(entry: AuditEntry): EventKind {
  const a = entry.action;
  if (a === "task.completed") return "milestone";
  if (a.startsWith("subtask.")) return "subtask";
  if (a === "task.status_changed" || a === "task.sent_for_approval") return "status";
  if (a === "attachment.note_added") return "note";
  return "default";
}

/** Which filter bucket an event belongs to (milestone/default ride under "all"). */
function filterBucket(kind: EventKind): "status" | "subtask" | "note" | null {
  if (kind === "status") return "status";
  if (kind === "subtask") return "subtask";
  if (kind === "note") return "note";
  return null;
}

function formatValue(action: string, field: string | null, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (action === "task.status_changed" || field === "status") {
    return STATUS_LABEL[String(value)] ?? String(value);
  }
  if (field === "priority") {
    return PRIORITY_LABEL[String(value)] ?? String(value);
  }
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return String(value);
  const str = String(value);
  if (str.length > 80) return `${str.slice(0, 77)}…`;
  return str;
}

/** Rich inline verb for events that don't get a structured payload. */
function describe(entry: AuditEntry): React.ReactNode {
  const meta = entry.metadata ?? {};
  switch (entry.action) {
    case "task.created":
      return <>created this task</>;
    case "task.status_changed":
      return <>moved status</>;
    case "task.field_changed": {
      const fieldLabel =
        entry.field === "builder_estimate_hours" ? "estimate" : entry.field ?? "field";
      return (
        <>
          changed <strong>{fieldLabel}</strong> from{" "}
          <em className="krowe-audit-em">{formatValue(entry.action, entry.field, entry.old_value)}</em>{" "}
          to{" "}
          <em className="krowe-audit-em">{formatValue(entry.action, entry.field, entry.new_value)}</em>
        </>
      );
    }
    case "task.completed":
      return <>marked task done</>;
    case "task.sent_for_approval":
      return <>sent task for approval</>;
    case "subtask.created":
      return <>added sub-task <em className="krowe-audit-em">{String(meta.title ?? "")}</em></>;
    case "subtask.completed":
      return <>completed sub-task</>;
    case "subtask.uncompleted":
      return <>reopened sub-task <em className="krowe-audit-em">{String(meta.title ?? "")}</em></>;
    case "subtask.renamed":
      return (
        <>
          renamed sub-task from{" "}
          <em className="krowe-audit-em">{String(entry.old_value ?? "")}</em> to{" "}
          <em className="krowe-audit-em">{String(entry.new_value ?? "")}</em>
        </>
      );
    case "subtask.deleted":
      return <>deleted sub-task <em className="krowe-audit-em">{String(meta.title ?? "")}</em></>;
    case "attachment.uploaded":
      return (
        <>
          uploaded <em className="krowe-audit-em">{String(meta.file_name ?? "file")}</em>
          {meta.is_deliverable ? <> as deliverable</> : null}
        </>
      );
    case "attachment.linked":
      return <>added link <em className="krowe-audit-em">{String(meta.label ?? meta.url ?? "")}</em></>;
    case "attachment.note_added":
      return <>added a note</>;
    case "attachment.removed":
      return <>removed <em className="krowe-audit-em">{String(meta.file_name ?? "attachment")}</em></>;
    case "task.commit_linked":
      return (
        <>
          linked commit{" "}
          <em className="krowe-audit-em">{String(meta.short_sha ?? "")}</em>
          {meta.message ? <> — {String(meta.message)}</> : null}
        </>
      );
    case "task.commit_unlinked":
      return (
        <>
          unlinked commit <em className="krowe-audit-em">{String(meta.short_sha ?? "")}</em>
        </>
      );
    default:
      return <>{entry.action.replace(/[._]/g, " ")}</>;
  }
}

/** Short plain-text rendering of an event for the digest summary line. */
function plainDescribe(entry: AuditEntry): string {
  const meta = entry.metadata ?? {};
  switch (entry.action) {
    case "task.created":
      return "created this task";
    case "task.status_changed":
      return `moved it to ${formatValue(entry.action, "status", entry.new_value)}`;
    case "task.completed":
      return meta.pushed_to_main ? "marked it done and pushed to main" : "marked it done";
    case "task.sent_for_approval":
      return "sent it for approval";
    case "subtask.completed":
      return "closed a sub-task";
    case "subtask.created":
      return "added a sub-task";
    case "attachment.uploaded":
      return "uploaded a file";
    case "task.commit_linked":
      return "linked a commit";
    default:
      return entry.action.replace(/[._]/g, " ");
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function EventNode({ kind, action }: { kind: EventKind; action: string }) {
  let icon: React.ReactNode;
  if (kind === "milestone") icon = <GitMerge className="h-[15px] w-[15px]" strokeWidth={2} />;
  else if (kind === "status") icon = <Repeat2 className="h-[15px] w-[15px]" />;
  else if (kind === "subtask") icon = <Check className="h-[14px] w-[14px]" />;
  else if (kind === "note") icon = <PenLine className="h-[15px] w-[15px]" />;
  else if (action.startsWith("attachment.") || action.startsWith("task.commit"))
    icon = <PenLine className="h-[15px] w-[15px]" />;
  else icon = <History className="h-[14px] w-[14px]" />;
  return <span className={`krowe-ev-node ${kind}`}>{icon}</span>;
}

function StatusTransition({ from, to }: { from: unknown; to: unknown }) {
  const fromKey = String(from ?? "");
  const toKey = String(to ?? "");
  return (
    <span className="krowe-status-transition">
      <span className={`krowe-st-chip ${fromKey}`}>{STATUS_LABEL[fromKey] ?? fromKey}</span>
      <span className="krowe-st-chip-arr">
        <ArrowRight className="h-[13px] w-[13px]" />
      </span>
      <span className={`krowe-st-chip ${toKey}`}>{STATUS_LABEL[toKey] ?? toKey}</span>
    </span>
  );
}

function AuditEvent({ entry }: { entry: AuditEntry }) {
  const kind = classify(entry);
  const name = actorName(entry.actor);
  const meta = entry.metadata ?? {};
  const showTransition =
    entry.action === "task.status_changed" &&
    entry.old_value != null &&
    entry.new_value != null;
  const showSubtaskChip = entry.action === "subtask.completed" && meta.title != null;
  const noteBody = meta.note ?? meta.body ?? meta.text;
  const showNoteBody = kind === "note" && typeof noteBody === "string" && noteBody.length > 0;
  const pushedToMain = entry.action === "task.completed" && Boolean(meta.pushed_to_main);

  return (
    <li className={`krowe-audit-ev ${kind === "milestone" ? "milestone-row" : ""}`}>
      <EventNode kind={kind} action={entry.action} />
      <div className="krowe-ev-body">
        <div className="krowe-ev-head">
          <span className="krowe-ev-actor">
            <span className={`krowe-ev-mini-avatar ${entry.actor?.role ?? "builder"}`}>
              {initials(name)}
            </span>
            <span className="who">{name}</span>
            {entry.actor && (
              <span className={`krowe-role-tag ${entry.actor.role}`}>{entry.actor.role}</span>
            )}
            <span className="verb">{describe(entry)}</span>
          </span>
          <span
            className="krowe-ev-time"
            title={new Date(entry.created_at).toLocaleString()}
          >
            {formatTime(entry.created_at)}
          </span>
        </div>

        {showTransition && (
          <div className="krowe-ev-payload">
            <StatusTransition from={entry.old_value} to={entry.new_value} />
          </div>
        )}

        {showSubtaskChip && (
          <div className="krowe-ev-payload">
            <span className="krowe-subtask-chip">
              <span className="sc-check">
                <Check className="h-[10px] w-[10px]" strokeWidth={2.4} />
              </span>
              <span className="sc-text">{String(meta.title)}</span>
            </span>
          </div>
        )}

        {showNoteBody && (
          <div className="krowe-ev-payload">
            <div className="krowe-ev-note">“{String(noteBody)}”</div>
          </div>
        )}

        {pushedToMain && (
          <div className="krowe-milestone-tag">
            <GitMerge className="h-3 w-3" />
            <span className="branch">pushed to main</span>
          </div>
        )}
      </div>
    </li>
  );
}

interface Props {
  taskId: string;
}

export function TaskAuditLog({ taskId }: Props) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "status" | "subtask" | "note">("all");

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError(null);
    setFilter("all");
    fetch(`/api/audit-log?taskId=${encodeURIComponent(taskId)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        setEntries(Array.isArray(data) ? (data as AuditEntry[]) : []);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load audit log");
        setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  const counts = useMemo(() => {
    const c = { all: 0, status: 0, subtask: 0, note: 0 };
    if (!entries) return c;
    c.all = entries.length;
    for (const e of entries) {
      const bucket = filterBucket(classify(e));
      if (bucket) c[bucket] += 1;
    }
    return c;
  }, [entries]);

  if (entries === null) {
    return <div className="krowe-audit-empty">Loading history…</div>;
  }

  if (error) {
    return <div className="krowe-audit-empty">Could not load history: {error}</div>;
  }

  if (entries.length === 0) {
    return <div className="krowe-audit-empty">No activity yet.</div>;
  }

  const shown =
    filter === "all"
      ? entries
      : entries.filter((e) => filterBucket(classify(e)) === filter);

  // Group by day, preserving the (newest-first) order from the API.
  const groups: { day: string; rows: AuditEntry[] }[] = [];
  for (const e of shown) {
    const day = dayKey(e.created_at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(e);
    else groups.push({ day, rows: [e] });
  }

  const people = Array.from(
    new Set(entries.map((e) => actorName(e.actor))),
  );
  const dayCount = new Set(entries.map((e) => dayKey(e.created_at))).size;
  const latest = entries[0];
  const spanText =
    dayCount <= 1 ? "in a single focused day" : `across ${dayCount} days`;
  const oldest = entries[entries.length - 1];
  const startedAtCreation = oldest?.action === "task.created";

  return (
    <div className="krowe-audit">
      {/* Digest */}
      <div className="krowe-audit-digest">
        <span className="krowe-audit-kicker">
          <Flame className="h-[13px] w-[13px]" />
          Audit log
        </span>
        <div className="krowe-audit-summary">
          <em>
            {entries.length} {entries.length === 1 ? "event" : "events"}
          </em>{" "}
          {spanText}
          {latest && (
            <>
              {" — most recently, "}
              {actorName(latest.actor)} {plainDescribe(latest)}.
            </>
          )}
        </div>
        <div className="krowe-audit-stats">
          <div className="krowe-audit-stat">
            <div className="num">{entries.length}</div>
            <div className="lbl">Events</div>
          </div>
          <div className="krowe-audit-stat">
            <div className="num">{counts.subtask}</div>
            <div className="lbl">Sub-task updates</div>
          </div>
          <div className="krowe-audit-stat">
            <div className="num">{people.length}</div>
            <div className="lbl">
              {people.length === 1 ? "Contributor" : "Contributors"}
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="krowe-audit-filters">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`krowe-audit-filter ${filter === f.id ? "active" : ""}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
            <span className="fc">{counts[f.id]}</span>
          </button>
        ))}
      </div>

      {/* Timeline */}
      {groups.length === 0 ? (
        <div className="krowe-audit-empty">Nothing matches this filter.</div>
      ) : (
        groups.map((g) => (
          <div className="krowe-audit-day" key={g.day}>
            <div className="krowe-audit-day-head">
              <span className="date">{g.day}</span>
              <span className="rule" />
              <span className="day-count">
                {g.rows.length} {g.rows.length === 1 ? "event" : "events"}
              </span>
            </div>
            <ul className="krowe-audit-line">
              {g.rows.map((e) => (
                <AuditEvent key={e.id} entry={e} />
              ))}
            </ul>
          </div>
        ))
      )}

      {filter === "all" && (
        <div className="krowe-audit-end">
          {startedAtCreation
            ? "Task created — the very beginning."
            : "Beginning of recorded history."}
          <span className="seed" />
        </div>
      )}
    </div>
  );
}
