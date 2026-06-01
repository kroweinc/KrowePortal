import { Flag } from "lucide-react";
import type { MilestoneWithProgress } from "@/lib/actions/milestones";

const STATUS_LABEL: Record<string, string> = {
  pending: "Not started",
  in_progress: "In progress",
  done: "Done",
};

function pct(done: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((done / total) * 100);
}

export function MilestoneProgressCard({ milestones }: { milestones: MilestoneWithProgress[] }) {
  if (milestones.length === 0) return null;

  const overallTotal = milestones.reduce((s, m) => s + m.taskTotal, 0);
  const overallDone = milestones.reduce((s, m) => s + m.taskDone, 0);

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Flag className="h-4 w-4 text-neutral-500" />
          <h2 className="text-sm font-semibold text-neutral-900">Milestones</h2>
        </div>
        <span className="text-xs text-neutral-500">
          {overallDone}/{overallTotal} tasks · {pct(overallDone, overallTotal)}%
        </span>
      </div>

      <div className="space-y-4">
        {milestones.map((m) => {
          const p = pct(m.taskDone, m.taskTotal);
          return (
            <div key={m.id}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-neutral-900">{m.title}</span>
                <span className="shrink-0 text-xs text-neutral-500">
                  {STATUS_LABEL[m.status] ?? m.status} · {m.taskDone}/{m.taskTotal}
                </span>
              </div>
              {m.description && <p className="mb-1.5 text-xs text-neutral-500">{m.description}</p>}
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                <div
                  className={`h-full rounded-full ${m.status === "done" ? "bg-emerald-500" : "bg-neutral-900"}`}
                  style={{ width: `${p}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
