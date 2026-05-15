import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { DEV_PROFILE_IDS } from "@/lib/auth";
import { Nav } from "@/components/nav";
import { OperatorTaskList } from "@/components/operator-task-list";
import { NewTaskForm } from "@/components/new-task-form";
import type { Engagement, Task } from "@/lib/types";

export default async function OperatorDashboard() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "operator") redirect("/b");

  const supabase = DEV_PROFILE_IDS.has(profile.id)
    ? createAdminClient()
    : await createClient();

  const { data: engagements } = await supabase
    .from("engagements")
    .select("*")
    .eq("operator_id", profile.id)
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
    <div className="min-h-screen bg-neutral-50">
      <Nav profile={profile} />
      <main className="mx-auto max-w-3xl px-6 py-10 space-y-8">
        <div>
          <h2 className="text-xl font-semibold text-neutral-900">Your Tasks</h2>
          {firstEngagement && (
            <p className="mt-0.5 text-sm text-neutral-400">
              {firstEngagement.title}
            </p>
          )}
        </div>

        <Suspense>
          <OperatorTaskList tasks={tasks} />
        </Suspense>
      </main>
      <NewTaskForm
        engagementId={firstEngagement?.id}
        placeholder="Describe something that needs to be built or fixed…"
      />
    </div>
  );
}
