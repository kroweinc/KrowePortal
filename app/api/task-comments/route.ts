import { NextRequest, NextResponse } from "next/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { isTaskMember } from "@/lib/actions/task-access";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// The task comment thread, plus the approval-loop events it renders alongside
// the messages. Both come back in one response so the client can merge them by
// timestamp without a second round-trip.
//
// Only the events that read as part of the conversation are included — a status
// nudge or a field edit belongs in the Audit Log tab, not in the thread.
const THREAD_EVENTS = [
  "task.sent_for_approval",
  "task.changes_requested",
  "task.approval_withdrawn",
  "task.approved",
];

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

  const [comments, events] = await Promise.all([
    supabase
      .from("task_comments")
      .select(
        "id, task_id, author_id, body, created_at, updated_at, deleted_at, author:profiles!author_id(id, display_name, role)"
      )
      .eq("task_id", taskId)
      .order("created_at", { ascending: true }),
    supabase
      .from("task_audit_log")
      .select("id, action, metadata, created_at, actor:profiles!actor_id(id, display_name, role)")
      .eq("task_id", taskId)
      .in("action", THREAD_EVENTS)
      .order("created_at", { ascending: true }),
  ]);

  if (comments.error) {
    return NextResponse.json({ error: comments.error.message }, { status: 500 });
  }
  if (events.error) {
    return NextResponse.json({ error: events.error.message }, { status: 500 });
  }

  // A soft-deleted comment keeps its row (so the thread keeps its shape) but
  // never ships its text — the client renders a "removed" placeholder.
  const rows = (comments.data ?? []).map((c) =>
    c.deleted_at ? { ...c, body: null } : c
  );

  return NextResponse.json({ comments: rows, events: events.data ?? [] });
}
