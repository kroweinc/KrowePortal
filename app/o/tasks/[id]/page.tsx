import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Nav } from "@/components/nav";
import { Badge } from "@/components/ui/badge";
import { DeleteTaskButton } from "@/components/delete-task-button";
import { OperatorTaskActions } from "@/app/o/tasks/[id]/operator-task-actions";
import Link from "next/link";
import type { Task, TaskPriority } from "@/lib/types";

const STATUS_LABELS: Record<string, string> = {
  inbox: "In Progress",
  in_progress: "In Progress",
  blocked: "Approval",
  done: "Done",
};

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

export default async function OperatorTaskDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "operator") redirect("/b");

  const supabase = await createClient();
  const { data } = await supabase
    .from("tasks")
    .select("*, engagement:engagements(*)")
    .eq("id", id)
    .single();

  if (!data) notFound();
  const task = data as Task;

  return (
    <div className="min-h-screen bg-neutral-50">
      <Nav profile={profile} />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <div className="mb-6">
          <Link href="/o" className="text-xs text-neutral-400 hover:text-neutral-700">
            ← Back to tasks
          </Link>
        </div>

        <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm space-y-5">
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-lg font-semibold text-neutral-900 leading-snug">
              {task.title}
            </h1>
            <div className="flex items-center gap-1.5">
              <Badge variant={task.priority}>{PRIORITY_LABELS[task.priority]}</Badge>
              <Badge variant={task.status as "inbox" | "in_progress" | "blocked" | "done"}>
                {STATUS_LABELS[task.status]}
              </Badge>
            </div>
          </div>

          {task.description && (
            <p className="text-sm text-neutral-600 leading-relaxed">{task.description}</p>
          )}

          <div className="flex flex-wrap gap-3 border-t border-neutral-100 pt-4 text-xs text-neutral-400">
            <span>
              Source:{" "}
              <Badge variant={task.source === "operator_request" ? "operator" : "builder"}>
                {task.source === "operator_request" ? "You requested this" : "Builder added"}
              </Badge>
            </span>
            {task.builder_estimate_hours && (
              <span>Estimate: {task.builder_estimate_hours}h</span>
            )}
            <span>Added: {new Date(task.created_at).toLocaleDateString()}</span>
          </div>
          <OperatorTaskActions task={task} />
          <DeleteTaskButton
            taskId={task.id}
            taskTitle={task.title}
            variant="full"
            redirectTo="/o"
          />
        </div>
      </main>
    </div>
  );
}
