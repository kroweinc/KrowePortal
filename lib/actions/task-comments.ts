"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { writeAuditEntry } from "@/lib/actions/audit-log";
import { isTaskMember, getOwnCommentTaskId } from "@/lib/actions/task-access";
import { requestTaskChanges } from "@/lib/actions/tasks";
import { notifyTaskEvent } from "@/lib/email/task-notify";
import type { TaskComment } from "@/lib/types";

// The thread in the task detail sheet (migration 0082). Both roles post here;
// the approval-loop events it renders alongside these rows come from
// task_audit_log, not from this table.

const SELECT = "*, author:profiles!author_id(id, display_name, role)";

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : createClient();
}

const bodySchema = z.string().trim().min(1, "Write something first").max(4000);
const addSchema = z.object({
  taskId: z.string().uuid(),
  body: bodySchema,
  requestChanges: z.boolean().optional(),
});

/**
 * Post a comment.
 *
 * With `requestChanges`, an operator's comment is *also* the formal send-back:
 * it delegates to requestTaskChanges, which owns the approval-state guards, the
 * status flip, the task.changes_requested audit entry and the builder's email.
 * That path deliberately skips the comment email — one event, one notification.
 * A failed send-back leaves the comment standing and returns its error, so the
 * operator's words are never lost to a state check.
 */
export async function addTaskComment(
  taskId: string,
  body: string,
  opts?: { requestChanges?: boolean }
): Promise<{ comment?: TaskComment; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = addSchema.safeParse({ taskId, body, requestChanges: opts?.requestChanges });
  if (!parsed.success) {
    // Only the body is user-typed — surface its message and keep the rest
    // (a malformed task id can't be acted on by the person writing).
    const bodyIssue = parsed.error.issues.find((i) => i.path[0] === "body");
    return { error: bodyIssue?.message ?? "Couldn't post that comment." };
  }
  if (!(await isTaskMember(parsed.data.taskId, profile.id)))
    return { error: "You don't have access to this task." };

  const supabase = await getClient(profile.id);
  const { data, error } = await supabase
    .from("task_comments")
    .insert({
      task_id: parsed.data.taskId,
      author_id: profile.id,
      body: parsed.data.body,
    })
    .select(SELECT)
    .single();

  if (error) return { error: error.message };
  const comment = data as TaskComment;

  await writeAuditEntry({
    taskId: parsed.data.taskId,
    actorId: profile.id,
    action: "task.comment_added",
    metadata: { comment_id: comment.id },
  });

  const alsoRequestChanges = parsed.data.requestChanges === true && profile.role === "operator";
  if (alsoRequestChanges) {
    const result = await requestTaskChanges(parsed.data.taskId, { note: parsed.data.body });
    if ("error" in result) return { comment, error: result.error };
    return { comment };
  }

  after(() =>
    notifyTaskEvent({
      taskId: parsed.data.taskId,
      actor: profile,
      event: "comment",
      note: parsed.data.body,
    })
  );

  return { comment };
}

/** Edit your own comment. Stamps updated_at, which is what surfaces the
 *  "edited" tag in the thread. */
export async function editTaskComment(
  commentId: string,
  body: string
): Promise<{ comment?: TaskComment; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid comment" };

  const taskId = await getOwnCommentTaskId(commentId, profile.id);
  if (!taskId) return { error: "You can only edit your own comments." };

  const supabase = await getClient(profile.id);
  const { data, error } = await supabase
    .from("task_comments")
    .update({ body: parsed.data, updated_at: new Date().toISOString() })
    .eq("id", commentId)
    .select(SELECT)
    .single();

  if (error) return { error: error.message };
  return { comment: data as TaskComment };
}

/** Soft-delete your own comment — the row stays so replies around it keep
 *  their context, and the thread renders a "comment removed" placeholder. */
export async function deleteTaskComment(
  commentId: string
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const taskId = await getOwnCommentTaskId(commentId, profile.id);
  if (!taskId) return { error: "You can only delete your own comments." };

  const supabase = await getClient(profile.id);
  const { error } = await supabase
    .from("task_comments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", commentId);

  if (error) return { error: error.message };

  await writeAuditEntry({
    taskId,
    actorId: profile.id,
    action: "task.comment_deleted",
    metadata: { comment_id: commentId },
  });

  return {};
}
