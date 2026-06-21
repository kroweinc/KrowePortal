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

  const isDeliverableParam = request.nextUrl.searchParams.get("isDeliverable");

  const supabase = await getClient(profile.id);
  let query = supabase
    .from("task_attachments")
    .select("*, uploader:profiles!uploaded_by(id, display_name, role)")
    .eq("task_id", taskId)
    .order("created_at", { ascending: false });

  if (isDeliverableParam !== null) {
    query = query.eq("is_deliverable", isDeliverableParam === "true");
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
