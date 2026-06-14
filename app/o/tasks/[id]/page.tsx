import { notFound, redirect } from "next/navigation";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { DeleteTaskButton } from "@/components/delete-task-button";
import { OperatorTaskActions } from "@/app/o/tasks/[id]/operator-task-actions";
import { TaskAttachments } from "@/components/task-attachments";
import Link from "next/link";
import type { Task, TaskAttachment, TaskPriority } from "@/lib/types";
import { formatHoursRange } from "@/lib/format-estimate";

const STATUS_LABELS: Record<string, string> = {
  inbox: "In Progress",
  in_progress: "In Progress",
  blocked: "Approval",
  done: "Done",
};

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  urgent: "Urgent",
  low: "Low",
  medium: "Medium",
  high: "High",
};

export const metadata = { title: "Task" };

export default async function OperatorTaskDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "operator") redirect("/b");

  const supabase = DEV_PROFILE_IDS.has(profile.id)
    ? createAdminClient()
    : await createClient();

  const [{ data }, { data: attachmentRows }] = await Promise.all([
    supabase
      .from("tasks")
      .select("*, engagement:engagements(*)")
      .eq("id", id)
      .single(),
    supabase
      .from("task_attachments")
      .select("*, uploader:profiles!uploaded_by(id, display_name, role)")
      .eq("task_id", id)
      .order("created_at", { ascending: false }),
  ]);

  if (!data) notFound();
  const task = data as Task;
  const attachments = (attachmentRows ?? []) as TaskAttachment[];

  return (
    <div className="min-h-screen bg-neutral-50">
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
            {(() => {
              const label = formatHoursRange(
                task.builder_estimate_low_hours,
                task.builder_estimate_high_hours,
                task.builder_estimate_hours
              );
              return label ? <span>Estimate: {label}</span> : null;
            })()}
            <span>Added: {new Date(task.created_at).toLocaleDateString()}</span>
          </div>

          <TaskAttachments
            taskId={task.id}
            role="operator"
            currentUserId={profile.id}
            initial={attachments}
          />

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
