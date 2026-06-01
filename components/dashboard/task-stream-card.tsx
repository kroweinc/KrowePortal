import { ListChecks } from "lucide-react";
import type { Task, Milestone } from "@/lib/types";

const STATUS_DOT: Record<string, string> = {
  inbox: "bg-neutral-300",
  in_progress: "bg-blue-500",
  blocked: "bg-amber-500",
  done: "bg-emerald-500",
};

const STATUS_LABEL: Record<string, string> = {
  inbox: "To do",
  in_progress: "In progress",
  blocked: "In review",
  done: "Done",
};

interface TaskStreamCardProps {
  milestones: Pick<Milestone, "id" | "title">[];
  tasks: Task[];
}

export function TaskStreamCard({ milestones, tasks }: TaskStreamCardProps) {
  if (tasks.length === 0) return null;

  const groups: { id: string | null; title: string; tasks: Task[] }[] = milestones.map((m) => ({
    id: m.id,
    title: m.title,
    tasks: tasks.filter((t) => t.milestone_id === m.id),
  }));

  const ungrouped = tasks.filter((t) => !t.milestone_id);
  if (ungrouped.length > 0) {
    groups.push({ id: null, title: "Other tasks", tasks: ungrouped });
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <ListChecks className="h-4 w-4 text-neutral-500" />
        <h2 className="text-sm font-semibold text-neutral-900">What&apos;s happening</h2>
      </div>

      <div className="space-y-5">
        {groups
          .filter((g) => g.tasks.length > 0)
          .map((g) => (
            <div key={g.id ?? "ungrouped"}>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                {g.title}
              </div>
              <ul className="space-y-1.5">
                {g.tasks.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 text-sm">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[t.status] ?? "bg-neutral-300"}`} />
                      <span className={`truncate ${t.status === "done" ? "text-neutral-400 line-through" : "text-neutral-800"}`}>
                        {t.title}
                      </span>
                    </div>
                    <span className="shrink-0 text-xs text-neutral-400">
                      {STATUS_LABEL[t.status] ?? t.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </div>
    </div>
  );
}
