import Link from "next/link";
import { Milestone } from "lucide-react";

import { TaskTypeBadge } from "@/components/task-type-badge";
import { STATUS_LABELS } from "@/lib/utils";
import type { AgentTasksWidget } from "@/lib/agent/types";

// The rendered form of the agent's `list_tasks` result: a compact, read-only
// task board that replaces the flat markdown list the model used to emit. It
// never mutates — every row links to the real task page (/b/tasks/[id]) where
// the controls live, keeping the palette read-focused. Presentational (no "use
// client"): it renders inside agent-thread's client tree but holds no state.
//
// Design (DESIGN.md is law): reuses the card token language via slim
// krowe-ah-tw* classes — rows at --radius-md, container at --radius-lg, priority
// dots and TaskTypeBadge shared with the board, no raw hex/px. Entrance is a
// staggered transform/opacity fade (honored down by prefers-reduced-motion).

export function AgentTaskBoard({ widget }: { widget: AgentTasksWidget }) {
  if (!widget.groups.length) return null;

  // A single running index across all groups so the entrance stagger reads as
  // one cascade down the board rather than restarting per section.
  let row = 0;

  return (
    <div className="krowe-ah-tw" role="group" aria-label={widget.title ?? "Tasks"}>
      {widget.title && <div className="krowe-ah-tw-title">{widget.title}</div>}
      {widget.groups.map((group) => (
        <section key={group.status} className="krowe-ah-tw-grp">
          <div className="krowe-ah-tw-ghead" data-status={group.status}>
            <span className="krowe-ah-tw-gdot" />
            <span className="krowe-ah-tw-glbl">{STATUS_LABELS[group.status]}</span>
            <span className="krowe-ah-tw-gcount">{group.tasks.length}</span>
          </div>
          <div className="krowe-ah-tw-rows">
            {group.tasks.map((t) => (
              <Link
                key={t.id}
                href={`/b/tasks/${t.id}`}
                className="krowe-ah-tw-row"
                style={{ animationDelay: `${Math.min(row++, 12) * 28}ms` }}
              >
                <span className={`krowe-prio-dot ${t.priority}`} aria-hidden="true">
                  <span className="d" />
                </span>
                <span className="krowe-ah-tw-rt">{t.title}</span>
                {t.milestoneTitle && (
                  <span className="krowe-ah-tw-ms" title={`Milestone: ${t.milestoneTitle}`}>
                    <Milestone width={11} height={11} strokeWidth={2} aria-hidden />
                    {t.milestoneTitle}
                  </span>
                )}
                <TaskTypeBadge type={t.type} />
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
