"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  FilePlus,
  Send,
  Eye,
  MessageSquare,
  Check,
  X,
  Trash2,
  CircleDot,
  Rocket,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { getProjectActivity } from "@/lib/actions/context-graph";
import type { EngagementTimeline, TimelineEntry } from "@/lib/context/lifecycle-analytics";
import { humanDuration } from "@/lib/context/duration";

/* ============================================================
   The project node's lifecycle history — the whole engagement's story in one
   chronological feed: every document event (created → sent → signed), task
   stage change, and relationship milestone (created/started/operator joined),
   interleaved by time with the gap since the previous moment. A compact rollup
   of the engagement's timing sits on top. Reads getProjectActivity, which runs
   the same unifier (document_events + task_audit_log + relationship timestamps)
   the AI context layer uses — so the panel and the AI see the same story.
   ============================================================ */

const DOC_KIND_LABEL: Record<string, string> = {
  prd: "PRD",
  quote: "Quote",
  contract: "Contract",
  brief: "Brief",
  change_order: "Change order",
};

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Dot color + icon for one stage. Positive terminals (signed/accepted/approved/
// done) read green, rejected red, a change request amber; everything else takes
// a tint by its kind so documents, tasks, and relationship moments read apart.
function entryVisual(e: TimelineEntry): { color: string; icon: ReactNode } {
  const s = e.stage;
  if (s === "signed" || s === "accepted" || s === "approved" || s === "done")
    return { color: "#10b981", icon: <Check size={12} strokeWidth={2.4} /> };
  if (s === "rejected") return { color: "#ef4444", icon: <X size={12} strokeWidth={2.4} /> };
  if (s === "changes requested")
    return { color: "#f59e0b", icon: <MessageSquare size={12} strokeWidth={2.2} /> };
  if (e.kind === "relationship") {
    if (s === "operator joined")
      return { color: "#5b9dff", icon: <UserPlus size={12} strokeWidth={2.2} /> };
    if (s === "started") return { color: "#f97316", icon: <Rocket size={12} strokeWidth={2.2} /> };
    return { color: "#f97316", icon: <Sparkles size={12} strokeWidth={2.2} /> };
  }
  if (e.kind === "task") {
    if (s === "sent for approval")
      return { color: "#3b82f6", icon: <Send size={12} strokeWidth={2.2} /> };
    return { color: "#94a3b8", icon: <CircleDot size={12} strokeWidth={2.2} /> };
  }
  // document, non-terminal
  if (s === "sent" || s === "re-sent")
    return { color: "#3b82f6", icon: <Send size={12} strokeWidth={2.2} /> };
  if (s === "viewed") return { color: "#94a3b8", icon: <Eye size={12} strokeWidth={2.2} /> };
  if (s === "deleted") return { color: "#9ca3af", icon: <Trash2 size={12} strokeWidth={2.2} /> };
  return { color: "#64748b", icon: <FilePlus size={12} strokeWidth={2.2} /> };
}

// Which artifact this moment belongs to — documents get a kind prefix, tasks a
// "Task" prefix, relationship moments just read as the engagement title.
function entityTag(e: TimelineEntry): string {
  if (e.kind === "document") {
    const k = e.docKind ? DOC_KIND_LABEL[e.docKind] ?? "Document" : "Document";
    return `${k} · ${e.entityLabel}`;
  }
  if (e.kind === "task") return `Task · ${e.entityLabel}`;
  return e.entityLabel;
}

function actorLine(e: TimelineEntry): string {
  const role = e.actorRole && e.actorRole !== "system" ? cap(e.actorRole) : null;
  if (e.actorName && (e.stage === "signed" || e.stage === "accepted"))
    return `by ${e.actorName}${role ? ` · ${role}` : ""}`;
  return role ? `by ${role}` : "";
}

export function ProjectHistory({ engagementId }: { engagementId: string }) {
  const [data, setData] = useState<EngagementTimeline | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    getProjectActivity(engagementId).then((d) => {
      if (!cancelled) setData(d);
    });
    return () => {
      cancelled = true;
    };
  }, [engagementId]);

  if (data === null) return <div className="ctx-timeline-empty">Loading history…</div>;

  const { entries, analytics } = data;
  if (entries.length === 0)
    return <div className="ctx-timeline-empty">No history recorded yet.</div>;

  const stats: string[] = [];
  if (analytics.lastActivityLabel) stats.push(`Last active ${analytics.lastActivityLabel}`);
  if (analytics.docsSent > 0) stats.push(`${analytics.docsSigned}/${analytics.docsSent} docs signed`);
  if (analytics.avgTimeToSignLabel) stats.push(`avg sign ${analytics.avgTimeToSignLabel}`);
  if (analytics.tasksCompleted > 0) stats.push(`${analytics.tasksCompleted} tasks done`);

  return (
    <div>
      {stats.length > 0 && (
        <div className="ctx-ph-summary">
          {stats.map((s, i) => (
            <span key={i} className="ctx-ph-stat">
              {s}
            </span>
          ))}
        </div>
      )}

      <div className="ctx-timeline">
        {entries.map((e, i) => {
          const v = entryVisual(e);
          const actor = actorLine(e);
          const prev = i > 0 ? entries[i - 1] : null;
          const gapMs = prev ? new Date(e.at).getTime() - new Date(prev.at).getTime() : null;
          return (
            <div key={`${e.kind}:${e.entityId}:${e.at}:${i}`} className="ctx-timeline-item">
              <span className="ctx-timeline-dot" style={{ background: v.color }}>
                {v.icon}
              </span>
              <div className="ctx-timeline-body">
                <div className="ctx-timeline-line">
                  <span className="ctx-timeline-label">{cap(e.stage)}</span>
                  <span className="ctx-timeline-when">{formatWhen(e.at)}</span>
                  {gapMs != null && gapMs > 0 && (
                    <span className="ctx-timeline-gap">+{humanDuration(gapMs)}</span>
                  )}
                </div>
                <div className="ctx-ph-entity">{entityTag(e)}</div>
                {actor && <div className="ctx-timeline-actor">{actor}</div>}
                {e.detail && <div className="ctx-timeline-detail">{e.detail}</div>}
              </div>
            </div>
          );
        })}
        {entries.length > 1 && (
          <div className="ctx-timeline-total">
            {humanDuration(
              new Date(entries[entries.length - 1].at).getTime() -
                new Date(entries[0].at).getTime()
            )}{" "}
            total
          </div>
        )}
      </div>
    </div>
  );
}
