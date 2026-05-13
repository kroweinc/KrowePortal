import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Nav } from "@/components/nav";
import { TaskBoard } from "@/components/task-board";
import { NewTaskForm } from "@/components/new-task-form";
import type { Engagement, Task } from "@/lib/types";

export default async function BuilderDashboard() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") redirect("/o");

  const supabase = await createClient();

  const { data: engagements } = await supabase
    .from("engagements")
    .select("*")
    .eq("builder_id", profile.id)
    .order("created_at", { ascending: true });

  const engagementList = (engagements ?? []) as Engagement[];
  const engagementIds = engagementList.map((e) => e.id);

  let tasks: Task[] = [];
  if (engagementIds.length > 0) {
    const { data } = await supabase
      .from("tasks")
      .select("*")
      .in("engagement_id", engagementIds)
      .order("created_at", { ascending: false });
    tasks = (data ?? []) as Task[];
  }

  const firstEngagement = engagementList[0];

  return (
    <div className="min-h-screen bg-neutral-50">
      <Nav profile={profile} />
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

        <TaskBoard tasks={tasks} engagements={engagementList} />

        {firstEngagement && (
          <div className="pt-4 border-t border-neutral-200">
            <p className="text-xs font-medium text-neutral-400 mb-3">
              Add a task to: {firstEngagement.title}
            </p>
            <NewTaskForm
              engagementId={firstEngagement.id}
              placeholder="Add something to the build queue…"
            />
          </div>
        )}
      </main>
    </div>
  );
}
