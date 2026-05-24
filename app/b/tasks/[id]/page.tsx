import { notFound, redirect } from "next/navigation";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { BuilderTaskActions } from "./builder-task-actions";
import { TaskAttachments } from "@/components/task-attachments";
import Link from "next/link";
import type { Task, TaskAttachment } from "@/lib/types";
import { formatHoursRange } from "@/lib/format-estimate";

const STATUS_LABELS: Record<string, string> = {
  inbox: "Inbox",
  in_progress: "In Progress",
  blocked: "Approval",
  done: "Done",
};

export default async function BuilderTaskDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") redirect("/o");

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
    <main className="mx-auto max-w-2xl px-6 py-10 space-y-6">
      <div>
        <Link href="/b" className="text-xs text-neutral-400 hover:text-neutral-700">
          ← Back to board
        </Link>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm space-y-5">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-lg font-semibold text-neutral-900 leading-snug">
            {task.title}
          </h1>
          <Badge variant={task.status as "inbox" | "in_progress" | "blocked" | "done"}>
            {STATUS_LABELS[task.status]}
          </Badge>
        </div>

        {task.description && (
          <p className="text-sm text-neutral-600 leading-relaxed">{task.description}</p>
        )}

        <div className="flex flex-wrap gap-2 text-xs text-neutral-400 border-t border-neutral-100 pt-4">
          <span>
            Source:{" "}
            <Badge variant={task.source === "operator_request" ? "operator" : "builder"}>
              {task.source === "operator_request" ? "Operator request" : "Builder added"}
            </Badge>
          </span>
          <span>
            Visibility:{" "}
            <Badge variant={task.operator_visible ? "outline" : "secondary"}>
              {task.operator_visible ? "Visible to operator" : "Hidden"}
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
        </div>

        <TaskAttachments
          taskId={task.id}
          role="builder"
          currentUserId={profile.id}
          initial={attachments}
        />
      </div>

      <BuilderTaskActions task={task} />
    </main>
  );
}
