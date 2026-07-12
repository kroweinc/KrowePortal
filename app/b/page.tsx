import { Suspense } from "react";
import Link from "next/link";
import { GitBranch } from "lucide-react";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { DEV_PROFILE_IDS } from "@/lib/auth";
import { TaskBoard } from "@/components/task-board";
import { TaskSortProvider, TaskSortControl } from "@/components/task-sort-context";
import { NewTaskForm } from "@/components/new-task-form";
import { CreateInvitationDialog } from "@/components/create-invitation-dialog";
import { ImportFromGranolaDialog } from "@/components/granola/import-from-granola-dialog";
import { getMyEngagements, getMyPendingInvites } from "@/lib/actions/invitations";
import { getSubmitterAvatarMap, attachCreatorAvatars } from "@/lib/submitter-avatars";
import { getBranchesByEngagement } from "@/lib/actions/get-engagement-branches";
import { getStagingGroupsByEngagement } from "@/lib/actions/staging-groups";
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

  // Personal (no-engagement) tasks are scoped to their creator. In prod RLS
  // enforces this; in dev the admin client bypasses RLS, so we scope explicitly
  // here — otherwise the null branch would surface every user's personal tasks.
  const personalFilter = `and(engagement_id.is.null,created_by.eq.${profile.id})`;
  const filter = engagementIds.length > 0
    ? `engagement_id.in.(${engagementIds.join(",")}),${personalFilter}`
    : personalFilter;

  // change_requests embeds the newest operator send-back per task so cards and
  // the detail sheet can surface "changes requested" without extra fetches —
  // see getActiveChangeRequest for when it counts as still actionable.
  const { data } = await supabase
    .from("tasks")
    .select(
      "*, task_attachments(id, is_deliverable, file_name), creator:profiles!created_by(display_name, role), staging_group:staging_groups(name), change_requests:task_audit_log(metadata, created_at, actor:profiles!actor_id(display_name))"
    )
    .or(filter)
    .eq("change_requests.action", "task.changes_requested")
    .order("created_at", { ascending: false })
    .order("created_at", { referencedTable: "change_requests", ascending: false })
    .limit(1, { referencedTable: "change_requests" });

  const rows = (data ?? []) as Task[];
  const avatars = await getSubmitterAvatarMap(rows.map((t) => t.created_by));
  const tasks = attachCreatorAvatars(rows, avatars);

  // Preload the cached repo branches + staging groups per engagement so the
  // task detail sheet's deliverable chips paint with no fetch.
  const [branchesByEngagement, stagingGroupsByEngagement] = await Promise.all([
    getBranchesByEngagement(engagementList),
    getStagingGroupsByEngagement(engagementIds),
  ]);
  const firstEngagement = engagementList[0];

  // Single-engagement first-run: surface the invite affordance right on the board.
  // Once there are multiple engagements, the Engagements page owns invites.
  const showInvite = engagementList.length <= 1 && !firstEngagement?.operator_id;

  return (
    <main className="krowe-page krowe-page-grid">
      <div className="krowe-page-inner">
        <TaskSortProvider>
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
              <Link href="/b/staging" className="krowe-pill-ghost">
                <GitBranch width={15} height={15} strokeWidth={2} />
                Staging
              </Link>
              {firstEngagement && (
                <ImportFromGranolaDialog
                  target={{
                    kind: "engagement",
                    engagementId: activeEngagement?.id ?? firstEngagement.id,
                  }}
                  engagements={engagementList.map((e) => ({ id: e.id, title: e.title }))}
                  triggerLabel="Tasks from meeting"
                  triggerClassName="krowe-pill-ghost"
                />
              )}
              <TaskSortControl />
              {showInvite && (
                <CreateInvitationDialog
                  engagementId={firstEngagement?.id}
                  existingToken={firstEngagement ? pendingInvites[firstEngagement.id]?.token : undefined}
                />
              )}
            </div>
          </div>
          <div data-tour="task-board">
            <Suspense>
              <TaskBoard
                tasks={tasks}
                engagements={engagementList}
                currentUserId={profile.id}
                branchesByEngagement={branchesByEngagement}
                stagingGroupsByEngagement={stagingGroupsByEngagement}
              />
            </Suspense>
          </div>
        </TaskSortProvider>
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
