import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { DEV_PROFILE_IDS } from "@/lib/auth";
import { Ember } from "@/components/design-atoms";
import { TaskBoard } from "@/components/task-board";
import { NewTaskForm } from "@/components/new-task-form";
import type { Engagement, Task } from "@/lib/types";

export default async function BuilderDashboard() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") redirect("/o");

  const supabase = DEV_PROFILE_IDS.has(profile.id)
    ? createAdminClient()
    : await createClient();

  const { data: engagements } = await supabase
    .from("engagements")
    .select("*")
    .eq("builder_id", profile.id)
    .order("created_at", { ascending: true });

  const engagementList = (engagements ?? []) as Engagement[];
  const engagementIds = engagementList.map((e) => e.id);

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

  return (
    <main className="krowe-page">
      <div className="krowe-page-inner">
        <div className="krowe-page-head">
          <div>
            <h1 className="krowe-page-title">
              <Ember size={22} /> Build Board
            </h1>
            <div className="krowe-page-sub">
              <span>{engagementList.length} engagement{engagementList.length !== 1 ? "s" : ""}</span>
              <span className="sep">·</span>
              <span>{tasks.length} task{tasks.length !== 1 ? "s" : ""}</span>
              <span className="sep">·</span>
              <span style={{ fontStyle: "italic", textTransform: "none", letterSpacing: "normal" }}>
                Let&apos;s see what&apos;s on deck today.
              </span>
            </div>
          </div>
        </div>
        <Suspense>
          <TaskBoard tasks={tasks} engagements={engagementList} currentUserId={profile.id} />
        </Suspense>
      </div>
      <NewTaskForm engagementId={firstEngagement?.id} placeholder="Add something to the build queue…" />
    </main>
  );
}
