"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Plus,
  Inbox,
  CircleDot,
  Loader,
  Ban,
  Send,
  Check,
  CheckCircle2,
} from "lucide-react";
import { getTaskHistory } from "@/lib/actions/context-graph";
import type { EntityLifecycle } from "@/lib/context/lifecycle-analytics";

/* ============================================================
   A task node's full lifecycle history — every stage this task moved through,
   in order (created → in progress → blocked → sent for approval → approved →
   done), each with who acted, when, and the gap since the prior stage, plus the
   total time from first stage to last. Reads getTaskHistory, which plucks this
   task's lifecycle out of the same engagement unifier the project history and
   the AI context layer use — so the three read the same story.

   This is the per-task counterpart to the "Completed" summary already on a done
   task node: Completed shows the *outcome* (duration, materials, commits); this
   shows the *journey*, and unlike Completed it renders for tasks in any state.
   ============================================================ */

// Dot color + icon per task stage — terminals (approved/done) read green, blocked
// red, sent-for-approval and in-progress blue; the early stages take a neutral
// slate tint. Mirrors the project history's task visuals so the timelines match.
const STAGE_META: Record<string, { color: string; icon: ReactNode }> = {
  created: { color: "#64748b", icon: <Plus size={12} strokeWidth={2.4} /> },
  inbox: { color: "#94a3b8", icon: <Inbox size={12} strokeWidth={2.2} /> },
  todo: { color: "#94a3b8", icon: <CircleDot size={12} strokeWidth={2.2} /> },
  "in progress": { color: "#3b82f6", icon: <Loader size={12} strokeWidth={2.2} /> },
  blocked: { color: "#ef4444", icon: <Ban size={12} strokeWidth={2.2} /> },
  "sent for approval": { color: "#3b82f6", icon: <Send size={12} strokeWidth={2.2} /> },
  approved: { color: "#10b981", icon: <Check size={12} strokeWidth={2.4} /> },
  done: { color: "#10b981", icon: <CheckCircle2 size={12} strokeWidth={2.2} /> },
};

const FALLBACK_VISUAL = { color: "#64748b", icon: <CircleDot size={12} strokeWidth={2.2} /> };

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

function actorLine(role: string | null): string {
  if (!role || role === "system") return "";
  return `by ${cap(role)}`;
}

export function TaskHistory({
  engagementId,
  taskId,
}: {
  engagementId: string;
  taskId: string;
}) {
  // undefined = loading, null = loaded-but-no-history, object = loaded.
  const [lc, setLc] = useState<EntityLifecycle | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setLc(undefined);
    getTaskHistory(engagementId, taskId).then((d) => {
      if (!cancelled) setLc(d);
    });
    return () => {
      cancelled = true;
    };
  }, [engagementId, taskId]);

  if (lc === undefined) return <div className="ctx-timeline-empty">Loading history…</div>;
  if (!lc || lc.stages.length === 0)
    return <div className="ctx-timeline-empty">No history recorded yet.</div>;

  return (
    <div className="ctx-timeline">
      {lc.stages.map((s, i) => {
        const visual = STAGE_META[s.stage] ?? FALLBACK_VISUAL;
        const actor = actorLine(s.actorRole);
        return (
          <div key={`${s.at}:${i}`} className="ctx-timeline-item">
            <span className="ctx-timeline-dot" style={{ background: visual.color }}>
              {visual.icon}
            </span>
            <div className="ctx-timeline-body">
              <div className="ctx-timeline-line">
                <span className="ctx-timeline-label">{cap(s.stage)}</span>
                <span className="ctx-timeline-when">{formatWhen(s.at)}</span>
                {s.sincePreviousLabel && (
                  <span className="ctx-timeline-gap">+{s.sincePreviousLabel}</span>
                )}
              </div>
              {actor && <div className="ctx-timeline-actor">{actor}</div>}
              {s.detail && <div className="ctx-timeline-detail">{s.detail}</div>}
            </div>
          </div>
        );
      })}
      {lc.totalElapsedLabel && (
        <div className="ctx-timeline-total">{lc.totalElapsedLabel} total</div>
      )}
    </div>
  );
}
