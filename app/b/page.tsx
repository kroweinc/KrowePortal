import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { DEV_PROFILE_IDS } from "@/lib/auth";
import { Ember } from "@/components/design-atoms";
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
    <main className="krowe-page">
      <div className="krowe-page-inner">
        <div className="krowe-page-head">
          <div>
            <h1 className="krowe-page-title">
              <Ember size={22} /> Build Board
            </h1>
            <div className="krowe-page-sub">
              <span>{tasks.length} task{tasks.length !== 1 ? "s" : ""}</span>
              <span className="sep">·</span>
              <span style={{ fontStyle: "italic", textTransform: "none", letterSpacing: "normal" }}>
                Let&apos;s see what&apos;s on deck today.
              </span>
            </div>
          </div>
          <CreateInvitationDialog
            existingToken={pendingInvite?.token}
            operatorName={operatorName ?? undefined}
          />
        </div>
        <Suspense>
          <TaskBoard tasks={tasks} currentUserId={profile.id} />
        </Suspense>
      </div>
      <NewTaskForm placeholder="Add something to the build queue…" />
    </main>
  );
}
