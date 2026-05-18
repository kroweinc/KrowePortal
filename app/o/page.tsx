import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { DEV_PROFILE_IDS } from "@/lib/auth";
import { Nav } from "@/components/nav";
import { OperatorTaskList } from "@/components/operator-task-list";
import { NewTaskForm } from "@/components/new-task-form";
import { DoneDeliverableProvider } from "@/components/done-deliverable-provider";
import type { Task } from "@/lib/types";

export default async function OperatorDashboard() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "operator") redirect("/b");

  const supabase = DEV_PROFILE_IDS.has(profile.id)
    ? createAdminClient()
    : await createClient();

  const { data } = await supabase
    .from("tasks")
    .select("*, task_attachments(*, uploader:profiles!uploaded_by(id, display_name, role))")
    .eq("operator_visible", true)
    .order("created_at", { ascending: false });

  const tasks = (data ?? []) as Task[];

  return (
    <div className="krowe-app">
      <Nav profile={profile} />
      <main className="krowe-page">
        <div className="krowe-page-inner" style={{ maxWidth: 960 }}>
          <div className="krowe-page-head">
            <div>
              <h1 className="krowe-page-title">Your Tasks</h1>
              <div className="krowe-page-sub">
                <span>{tasks.length} task{tasks.length !== 1 ? "s" : ""}</span>
                <span className="sep">·</span>
                <span style={{ fontStyle: "italic", textTransform: "none", letterSpacing: "normal" }}>
                  Here&apos;s what your builder is working on.
                </span>
              </div>
            </div>
          </div>
          <DoneDeliverableProvider>
            <Suspense>
              <OperatorTaskList tasks={tasks} currentUserId={profile.id} />
            </Suspense>
          </DoneDeliverableProvider>
        </div>
      </main>
      <NewTaskForm placeholder="Describe something that needs to be built or fixed…" />
    </div>
  );
}
