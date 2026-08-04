import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import {
  notifyUser,
  taskApprovalRequestedEmail,
  taskApprovedEmail,
  taskChangesRequestedEmail,
  taskCommentEmail,
  taskDeliveredEmail,
} from "@/lib/email/notify";
import type { Profile } from "@/lib/types";

/**
 * Task-lifecycle email dispatch.
 *
 * The recipient is always the *counterparty* of the actor, resolved from
 * server-verified engagement membership — never from client input. Builder
 * actions notify the operator; operator actions notify the builder. Personal
 * tasks (no engagement) and engagements with no operator yet (invite not
 * accepted) resolve to no recipient and skip silently.
 *
 * Best-effort, exactly like lib/email/notify.ts: never throws, so it can be
 * fired fire-and-forget with `void` from inside an `after()` block.
 */

export type TaskNotifyEvent =
  // builder → operator
  | "approval_requested"
  | "delivered"
  // operator → builder
  | "approved"
  | "changes_requested"
  // either direction — whoever didn't write the comment gets the mail
  | "comment";

type NotifyTargets = {
  taskTitle: string;
  engagementId: string;
  builderId: string;
  operatorId: string | null;
};

/** Resolve a task's title and engagement members via the admin client. Mirrors
    the embed shape of isTaskMember (task-access.ts). Returns null for a
    personal/no-engagement task. */
async function resolveTaskNotifyTargets(taskId: string): Promise<NotifyTargets | null> {
  const admin = createAdminClient();
  const { data: task } = await admin
    .from("tasks")
    .select("title, engagement_id, engagement:engagements(builder_id, operator_id)")
    .eq("id", taskId)
    .maybeSingle();

  if (!task || !task.engagement_id) return null;

  // Supabase types a to-one embed as either an object or a single-element array
  // depending on the join — handle both (same as task-access.ts).
  const embed = task.engagement as unknown;
  const e = Array.isArray(embed) ? embed[0] : embed;
  if (!e || typeof e !== "object") return null;
  const { builder_id, operator_id } = e as { builder_id?: string; operator_id?: string | null };
  if (typeof builder_id !== "string") return null;

  return {
    taskTitle: (task.title as string) ?? "a task",
    engagementId: task.engagement_id as string,
    builderId: builder_id,
    operatorId: (operator_id as string | null) ?? null,
  };
}

function actorName(actor: Pick<Profile, "role" | "display_name">): string {
  return actor.display_name?.trim() || (actor.role === "operator" ? "Your operator" : "Your builder");
}

export async function notifyTaskEvent(opts: {
  taskId: string;
  actor: Pick<Profile, "id" | "role" | "display_name">;
  event: TaskNotifyEvent;
  note?: string | null;
}): Promise<void> {
  const targets = await resolveTaskNotifyTargets(opts.taskId);
  if (!targets) return;

  const name = actorName(opts.actor);
  const { taskTitle } = targets;

  switch (opts.event) {
    case "approval_requested": {
      if (!targets.operatorId) return;
      const { subject, html } = taskApprovalRequestedEmail({ taskTitle, builderName: name, note: opts.note ?? null });
      await notifyUser({ userId: targets.operatorId, type: "task_approval_requested", subject, html });
      return;
    }
    case "delivered": {
      if (!targets.operatorId) return;
      const { subject, html } = taskDeliveredEmail({ taskTitle, builderName: name, note: opts.note ?? null });
      await notifyUser({ userId: targets.operatorId, type: "task_delivered", subject, html });
      return;
    }
    case "approved": {
      const { subject, html } = taskApprovedEmail({ taskTitle, operatorName: name });
      await notifyUser({ userId: targets.builderId, type: "task_approved", subject, html });
      return;
    }
    case "changes_requested": {
      const { subject, html } = taskChangesRequestedEmail({ taskTitle, operatorName: name, note: opts.note ?? null });
      await notifyUser({ userId: targets.builderId, type: "task_changes_requested", subject, html });
      return;
    }
    case "comment": {
      // The one bidirectional event: the recipient is whichever member didn't
      // write it. An operator commenting on their own engagement still reaches
      // the builder, and vice versa.
      const recipientId =
        opts.actor.role === "operator" ? targets.builderId : targets.operatorId;
      if (!recipientId) return;
      const { subject, html } = taskCommentEmail({
        taskTitle,
        authorName: name,
        authorRole: opts.actor.role,
        body: opts.note ?? "",
      });
      await notifyUser({ userId: recipientId, type: "task_comment", subject, html });
      return;
    }
  }
}
