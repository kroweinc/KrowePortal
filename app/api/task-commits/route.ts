import { NextRequest, NextResponse } from "next/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { isTaskMember } from "@/lib/actions/task-access";
import { createClient, createAdminClient } from "@/lib/supabase/server";

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : createClient();
}

export async function GET(request: NextRequest) {
  const taskId = request.nextUrl.searchParams.get("taskId");
  if (!taskId) {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isTaskMember(taskId, profile.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await getClient(profile.id);
  const { data, error } = await supabase
    .from("task_commits")
    .select(
      "id, repo_full_name, commit_sha, commit_url, commit_message, commit_author_name, commit_author_login, commit_committed_at, linked_at, linked_by"
    )
    .eq("task_id", taskId)
    .order("linked_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
