import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { DEV_PROFILE_IDS } from "@/lib/auth";
import { TaskBoard } from "@/components/task-board";
import { NewTaskForm } from "@/components/new-task-form";
import { CreateInvitationDialog } from "@/components/create-invitation-dialog";
import { getMyEngagement, getMyPendingInvite } from "@/lib/actions/invitations";
import type { Task } from "@/lib/types";

export default async function BuilderDashboard() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") redirect("/o");

  const supabase = DEV_PROFILE_IDS.has(profile.id)
    ? createAdminClient()
    : await createClient();

  const [{ data }, engagement, pendingInvite] = await Promise.all([
    supabase
      .from("tasks")
      .select("*, task_attachments(*, uploader:profiles!uploaded_by(id, display_name, role))")
      .order("created_at", { ascending: false }),
    getMyEngagement(),
    getMyPendingInvite(),
  ]);
  const tasks = (data ?? []) as Task[];

  const operatorName = engagement?.operator?.display_name ?? null;

  return (
    <>
      <main className="mx-auto max-w-6xl px-6 py-10 space-y-8">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-neutral-900">Build Board</h2>
            <p className="mt-0.5 text-sm text-neutral-400">
              {tasks.length} task{tasks.length !== 1 ? "s" : ""}
            </p>
          </div>
          <CreateInvitationDialog
            existingToken={pendingInvite?.token}
            operatorName={operatorName ?? undefined}
          />
        </div>

        <Suspense>
          <TaskBoard tasks={tasks} currentUserId={profile.id} />
        </Suspense>
      </main>
      <NewTaskForm placeholder="Add something to the build queue…" />
    </>
  );
}
