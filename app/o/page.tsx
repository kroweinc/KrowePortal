import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { DEV_PROFILE_IDS } from "@/lib/auth";
import { OperatorTaskList } from "@/components/operator-task-list";
import { NewTaskForm } from "@/components/new-task-form";
import { getSubmitterAvatarMap, attachCreatorAvatars } from "@/lib/submitter-avatars";
import type { Engagement, Task } from "@/lib/types";

export const metadata = { title: "Tasks" };

export default async function OperatorDashboard() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "operator") redirect("/b");

  const supabase = DEV_PROFILE_IDS.has(profile.id)
    ? createAdminClient()
    : await createClient();

  const { data: engagements } = await supabase
    .from("engagements")
    .select("*, builder:profiles!builder_id(display_name)")
    .eq("operator_id", profile.id)
    .order("created_at", { ascending: true });

  const engagementList = (engagements ?? []) as Engagement[];
  const engagementIds = engagementList.map((e) => e.id);

  // Personal (no-engagement) tasks are scoped to their creator. In prod RLS
  // enforces this; in dev the admin client bypasses RLS, so we scope explicitly
  // here — otherwise the null branch would surface every user's personal tasks.
  const personalFilter = `and(engagement_id.is.null,created_by.eq.${profile.id})`;
  const filter = engagementIds.length > 0
    ? `engagement_id.in.(${engagementIds.join(",")}),${personalFilter}`
    : personalFilter;

  const { data } = await supabase
    .from("tasks")
    .select(
      "*, task_attachments(id, is_deliverable, file_name), creator:profiles!created_by(display_name, role), task_subtasks(id, title, completed)"
    )
    .or(filter)
    .order("created_at", { ascending: false });

  const rows = (data ?? []) as Task[];
  const avatars = await getSubmitterAvatarMap(rows.map((t) => t.created_by));
  const tasks = attachCreatorAvatars(rows, avatars);
  const firstEngagement = engagementList[0];

  // Panels address the builder by name only when every engagement shares one
  // builder — with several builders the copy falls back to generic wording.
  const builderNames = new Set(
    engagementList.map((e) => e.builder?.display_name?.trim()).filter(Boolean)
  );
  const builderName = builderNames.size === 1 ? [...builderNames][0]! : null;

  return (
    <>
      <main className="krowe-page">
        <div className="krowe-page-inner" style={{ maxWidth: 1260 }}>
          <div className="krowe-page-head">
            <div>
              <h1 className="krowe-page-title">Your Tasks</h1>
              <div className="krowe-page-sub">
                <span>
                  {engagementList.length === 1
                    ? firstEngagement.title
                    : `${engagementList.length} projects`}
                </span>
                <span className="sep">·</span>
                <span>{tasks.length} task{tasks.length !== 1 ? "s" : ""}</span>
                <span className="sep">·</span>
                <span className="krowe-quip">
                  Here&apos;s where things stand{builderName ? ` with ${builderName.split(/\s+/)[0]}` : ""}.
                </span>
              </div>
            </div>
          </div>
          <Suspense>
            <OperatorTaskList tasks={tasks} currentUserId={profile.id} builderName={builderName} />
          </Suspense>
        </div>
      </main>
      <NewTaskForm
        engagementId={firstEngagement?.id}
        placeholder="Describe something that needs to be built or fixed…"
      />
    </>
  );
}
