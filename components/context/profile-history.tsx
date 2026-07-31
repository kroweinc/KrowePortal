"use client";

import { useEffect, useState } from "react";
import { getProfileEvents, type ProfileEventRow } from "@/lib/actions/context-graph";

/* ============================================================
   A person's profile change history — every recorded update to this builder's
   or operator's profile mirror, newest first, each shown as a field-level diff:
   what changed, and what it was before. Reads profile_events (written at
   profile-sync time by recordProfileEvent).
   ============================================================ */

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

export function ProfileHistory({
  engagementId,
  role,
}: {
  engagementId: string;
  role: "builder" | "operator";
}) {
  const [events, setEvents] = useState<ProfileEventRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEvents(null);
    getProfileEvents(engagementId, role).then((rows) => {
      if (!cancelled) setEvents(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [engagementId, role]);

  if (events === null) return <div className="ctx-timeline-empty">Loading history…</div>;
  if (events.length === 0)
    return <div className="ctx-timeline-empty">No profile changes recorded yet.</div>;

  return (
    <div className="ctx-prof-hist">
      {events.map((ev) => {
        const n = ev.changes.length;
        return (
          <div key={ev.id} className="ctx-prof-event">
            <div className="ctx-prof-head">
              <span className="ctx-prof-when">{formatWhen(ev.created_at)}</span>
              <span className="ctx-prof-count">
                {n} field{n === 1 ? "" : "s"} changed
              </span>
            </div>
            <div className="ctx-prof-changes">
              {ev.changes.map((c, i) => (
                <div key={i} className="ctx-prof-change">
                  <div className="ctx-prof-field">{c.field}</div>
                  {c.removed.map((line, j) => (
                    <div key={`r${j}`} className="ctx-prof-line from">
                      <span className="mk" aria-hidden="true">
                        −
                      </span>
                      <span className="tx">{line}</span>
                    </div>
                  ))}
                  {c.added.map((line, j) => (
                    <div key={`a${j}`} className="ctx-prof-line to">
                      <span className="mk" aria-hidden="true">
                        +
                      </span>
                      <span className="tx">{line}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
