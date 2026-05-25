"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";

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

function actorName(actor: AuditActor | null): string {
  if (!actor) return "Someone";
  if (actor.display_name && actor.display_name.trim().length > 0) {
    return actor.display_name;
  }
  return actor.role === "operator" ? "Operator" : "Builder";
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

function describe(entry: AuditEntry): React.ReactNode {
  const meta = entry.metadata ?? {};
  switch (entry.action) {
    case "task.created":
      return <>created this task</>;
    case "task.status_changed":
      return (
        <>
          moved status from{" "}
          <em className="krowe-audit-em">{formatValue(entry.action, "status", entry.old_value)}</em>{" "}
          to{" "}
          <em className="krowe-audit-em">{formatValue(entry.action, "status", entry.new_value)}</em>
        </>
      );
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
      return meta.pushed_to_main
        ? <>marked task done <em className="krowe-audit-em">(pushed to main)</em></>
        : <>marked task done</>;
    case "task.sent_for_approval":
      return <>sent task for approval</>;
    case "task.visibility_changed":
      return entry.new_value
        ? <>made task <strong>visible</strong> to operator</>
        : <>made task <strong>hidden</strong> from operator</>;
    case "subtask.created":
      return <>added subtask <em className="krowe-audit-em">{String(meta.title ?? "")}</em></>;
    case "subtask.completed":
      return <>completed subtask <em className="krowe-audit-em">{String(meta.title ?? "")}</em></>;
    case "subtask.uncompleted":
      return <>reopened subtask <em className="krowe-audit-em">{String(meta.title ?? "")}</em></>;
    case "subtask.renamed":
      return (
        <>
          renamed subtask from{" "}
          <em className="krowe-audit-em">{String(entry.old_value ?? "")}</em> to{" "}
          <em className="krowe-audit-em">{String(entry.new_value ?? "")}</em>
        </>
      );
    case "subtask.deleted":
      return <>deleted subtask <em className="krowe-audit-em">{String(meta.title ?? "")}</em></>;
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
          unlinked commit{" "}
          <em className="krowe-audit-em">{String(meta.short_sha ?? "")}</em>
        </>
      );
    default:
      return <>{entry.action.replace(/[._]/g, " ")}</>;
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString();
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

interface Props {
  taskId: string;
}

export function TaskAuditLog({ taskId }: Props) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError(null);
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

  const header = (
    <div className="krowe-task-section-h">
      <span className="label">
        <History className="h-3 w-3" />
        Audit Log
      </span>
    </div>
  );

  if (entries === null) {
    return (
      <section className="krowe-task-section">
        {header}
        <div className="krowe-audit-empty">Loading history…</div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="krowe-task-section">
        {header}
        <div className="krowe-audit-empty">Could not load history: {error}</div>
      </section>
    );
  }

  if (entries.length === 0) {
    return (
      <section className="krowe-task-section">
        {header}
        <div className="krowe-audit-empty">No activity yet.</div>
      </section>
    );
  }

  const groups: { day: string; rows: AuditEntry[] }[] = [];
  for (const e of entries) {
    const day = dayKey(e.created_at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(e);
    else groups.push({ day, rows: [e] });
  }

  return (
    <section className="krowe-task-section">
      {header}
      <div className="krowe-audit-timeline">
        {groups.map((g) => (
          <div key={g.day} className="krowe-audit-group">
            <div className="krowe-audit-day">{g.day}</div>
            <ul className="krowe-audit-list">
              {g.rows.map((e) => (
                <li key={e.id} className="krowe-audit-row">
                  <span className="krowe-audit-dot" aria-hidden />
                  <div className="krowe-audit-body">
                    <div className="krowe-audit-line">
                      <span className="krowe-audit-actor">{actorName(e.actor)}</span>
                      {e.actor && (
                        <span className={`krowe-audit-role ${e.actor.role}`}>
                          {e.actor.role}
                        </span>
                      )}
                      <span className="krowe-audit-verb"> {describe(e)}</span>
                    </div>
                    <div className="krowe-audit-time" title={new Date(e.created_at).toLocaleString()}>
                      {formatTime(e.created_at)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
