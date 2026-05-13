import { TaskCard } from "@/components/task-card";
import type { Task } from "@/lib/types";

const STATUS_ORDER = ["inbox", "in_progress", "blocked", "done"] as const;
const STATUS_LABELS: Record<string, string> = {
  inbox: "Inbox",
  in_progress: "In Progress",
  blocked: "Blocked",
  done: "Done",
};

interface OperatorTaskListProps {
  tasks: Task[];
}

export function OperatorTaskList({ tasks }: OperatorTaskListProps) {
  if (tasks.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-200 py-12 text-center">
        <p className="text-sm text-neutral-400">No tasks yet. Describe your first need below.</p>
      </div>
    );
  }

  const grouped = STATUS_ORDER.reduce<Record<string, Task[]>>((acc, s) => {
    acc[s] = tasks.filter((t) => t.status === s);
    return acc;
  }, {} as Record<string, Task[]>);

  return (
    <div className="space-y-8">
      {STATUS_ORDER.map((status) => {
        const group = grouped[status];
        if (group.length === 0) return null;
        return (
          <div key={status}>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-400">
              {STATUS_LABELS[status]} · {group.length}
            </h3>
            <div className="space-y-3">
              {group.map((task) => (
                <TaskCard key={task.id} task={task} role="operator" />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
