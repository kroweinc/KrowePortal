import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { DEV_PROFILE_IDS } from "@/lib/auth";
import { TaskBoard } from "@/components/task-board";
import { NewTaskForm } from "@/components/new-task-form";
import { CreateInvitationDialog } from "@/components/create-invitation-dialog";
import { getMyEngagements, getMyPendingInvites } from "@/lib/actions/invitations";
import type { Task } from "@/lib/types";

export const metadata = { title: "Tasks" };

export default async function BuilderDashboard({
  searchParams,
}: {
  searchParams: Promise<{ engagement?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") redirect("/o");

  const supabase = DEV_PROFILE_IDS.has(profile.id)
    ? createAdminClient()
    : await createClient();

  const [engagementList, pendingInvites, { engagement: engagementParam }] = await Promise.all([
    getMyEngagements(),
    getMyPendingInvites(),
    searchParams,
  ]);

  const engagementIds = engagementList.map((e) => e.id);
  const activeEngagement = engagementList.find((e) => e.id === engagementParam);

  const filter = engagementIds.length > 0
    ? `engagement_id.in.(${engagementIds.join(",")}),engagement_id.is.null`
    : "engagement_id.is.null";

  const { data } = await supabase
    .from("tasks")
    .select("*, task_attachments(*, uploader:profiles!uploaded_by(id, display_name, role))")
    .or(filter)
    .order("created_at", { ascending: false });

  const tasks = (data ?? []) as Task[];
  const firstEngagement = engagementList[0];

  // Single-engagement first-run: surface the invite affordance right on the board.
  // Once there are multiple engagements, the Engagements page owns invites.
  const showInvite = engagementList.length <= 1 && !firstEngagement?.operator_id;
  const operatorName =
    engagementList.length === 1 ? firstEngagement?.operator?.display_name ?? null : null;

  return (
    <main className="krowe-page krowe-page-grid">
      <div className="krowe-page-inner">
        <div className="krowe-board-head">
          <div className="krowe-board-titlewrap">
            <h1 className="krowe-board-title">Build Board</h1>
            <div className="krowe-board-sub">
              <span>{engagementList.length} client{engagementList.length !== 1 ? "s" : ""}</span>
              <span className="sep">·</span>
              <span>{tasks.length} task{tasks.length !== 1 ? "s" : ""}</span>
              <span className="sep">·</span>
              <span>Let&apos;s see what&apos;s on deck today.</span>
            </div>
          </div>
          <div className="krowe-board-actions">
            <Link href="/b/engagements" className="krowe-pill-ghost">
              Clients
            </Link>
            {(showInvite || operatorName) && (
              <CreateInvitationDialog
                engagementId={firstEngagement?.id}
                existingToken={firstEngagement ? pendingInvites[firstEngagement.id]?.token : undefined}
                operatorName={operatorName ?? undefined}
              />
            )}
          </div>
        </div>
        <div data-tour="task-board">
          <Suspense>
            <TaskBoard tasks={tasks} engagements={engagementList} currentUserId={profile.id} />
          </Suspense>
        </div>
      </div>
      <NewTaskForm
        engagementId={activeEngagement?.id ?? firstEngagement?.id}
        engagements={engagementList.map((e) => ({ id: e.id, title: e.title }))}
        placeholder="Add something to the build queue…"
        tourId="new-task"
      />
    </main>
  );
}
