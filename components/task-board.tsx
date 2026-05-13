import { TaskCard } from "@/components/task-card";
import type { Task, Engagement } from "@/lib/types";

const COLUMNS = [
  { status: "inbox", label: "Inbox" },
  { status: "in_progress", label: "In Progress" },
  { status: "blocked", label: "Blocked" },
  { status: "done", label: "Done" },
] as const;

interface TaskBoardProps {
  tasks: Task[];
  engagements: Engagement[];
}

export function TaskBoard({ tasks, engagements }: TaskBoardProps) {
  const engagementMap = new Map(engagements.map((e) => [e.id, e.title]));

  if (tasks.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-200 py-12 text-center">
        <p className="text-sm text-neutral-400">
          No tasks across any of your engagements yet.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {COLUMNS.map(({ status, label }) => {
        const columnTasks = tasks.filter((t) => t.status === status);
        return (
          <div key={status} className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                {label}
              </h3>
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">
                {columnTasks.length}
              </span>
            </div>
            {columnTasks.length === 0 ? (
              <div className="rounded-lg border border-dashed border-neutral-100 py-8 text-center">
                <p className="text-xs text-neutral-300">Empty</p>
              </div>
            ) : (
              <div className="space-y-3">
                {columnTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    role="builder"
                    engagementTitle={engagementMap.get(task.engagement_id)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
