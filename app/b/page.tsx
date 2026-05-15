import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { DEV_PROFILE_IDS } from "@/lib/auth";
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

  let tasks: Task[] = [];
  const filter = engagementIds.length > 0
    ? `engagement_id.in.(${engagementIds.join(",")}),engagement_id.is.null`
    : "engagement_id.is.null";
  const { data } = await supabase
    .from("tasks")
    .select("*")
    .or(filter)
    .order("created_at", { ascending: false });
  tasks = (data ?? []) as Task[];

  const firstEngagement = engagementList[0];

  return (
    <>
      <main className="mx-auto max-w-6xl px-6 py-10 space-y-8">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-neutral-900">Build Board</h2>
            <p className="mt-0.5 text-sm text-neutral-400">
              {engagementList.length} engagement{engagementList.length !== 1 ? "s" : ""}
              {" · "}
              {tasks.length} task{tasks.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        <Suspense>
          <TaskBoard tasks={tasks} engagements={engagementList} />
        </Suspense>
      </main>
      <NewTaskForm
        engagementId={firstEngagement?.id}
        placeholder="Add something to the build queue…"
      />
    </>
  );
}
