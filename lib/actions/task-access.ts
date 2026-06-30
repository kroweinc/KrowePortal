import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { DEV_PROFILE_IDS } from "@/lib/auth";

// Defense-in-depth authorization for the task/engagement domain.
//
// RLS already enforces these rules for the normal (cookie-bound) client, but
// many actions read/write through the admin client (which bypasses RLS), and a
// single forgotten check would otherwise be unprotected. These helpers give an
// explicit app-level guard that does NOT depend on RLS.
//
// Membership model:
//   - engagement task  → the engagement's builder or operator
//   - personal task    → the task's creator (no engagement)
//   - engagement       → its builder or operator
//
// Dev identities short-circuit to true: they already bypass RLS via the admin
// client everywhere else and own no real rows to match against.

type EngagementMembers = { builder_id: string; operator_id: string | null };

function membersFromEmbed(embed: unknown): EngagementMembers | null {
  // Supabase embeds a to-one relation as an object, but can type/return it as a
  // single-element array depending on the join — handle both.
  const e = Array.isArray(embed) ? embed[0] : embed;
  if (!e || typeof e !== "object") return null;
  const { builder_id, operator_id } = e as Partial<EngagementMembers>;
  if (typeof builder_id !== "string") return null;
  return { builder_id, operator_id: (operator_id as string | null) ?? null };
}

function isMember(members: EngagementMembers, profileId: string): boolean {
  return members.builder_id === profileId || members.operator_id === profileId;
}

export async function isTaskMember(taskId: string, profileId: string): Promise<boolean> {
  if (DEV_PROFILE_IDS.has(profileId)) return true;

  const admin = createAdminClient();
  const { data: task } = await admin
    .from("tasks")
    .select("created_by, engagement_id, engagement:engagements(builder_id, operator_id)")
    .eq("id", taskId)
    .maybeSingle();

  if (!task) return false;
  if (!task.engagement_id) return task.created_by === profileId;

  const members = membersFromEmbed(task.engagement);
  return members ? isMember(members, profileId) : false;
}

export async function isEngagementMember(
  engagementId: string,
  profileId: string
): Promise<boolean> {
  if (DEV_PROFILE_IDS.has(profileId)) return true;

  const admin = createAdminClient();
  const { data } = await admin
    .from("engagements")
    .select("builder_id, operator_id")
    .eq("id", engagementId)
    .maybeSingle();

  return data ? isMember(data as EngagementMembers, profileId) : false;
}

async function taskIdForChild(
  table: "task_subtasks" | "task_attachments" | "task_commits",
  childId: string
): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin.from(table).select("task_id").eq("id", childId).maybeSingle();
  return (data?.task_id as string | undefined) ?? null;
}

export async function isSubtaskMember(subtaskId: string, profileId: string): Promise<boolean> {
  if (DEV_PROFILE_IDS.has(profileId)) return true;
  const taskId = await taskIdForChild("task_subtasks", subtaskId);
  return taskId ? isTaskMember(taskId, profileId) : false;
}

export async function isAttachmentMember(
  attachmentId: string,
  profileId: string
): Promise<boolean> {
  if (DEV_PROFILE_IDS.has(profileId)) return true;
  const taskId = await taskIdForChild("task_attachments", attachmentId);
  return taskId ? isTaskMember(taskId, profileId) : false;
}

export async function isTaskCommitMember(
  taskCommitId: string,
  profileId: string
): Promise<boolean> {
  if (DEV_PROFILE_IDS.has(profileId)) return true;
  const taskId = await taskIdForChild("task_commits", taskCommitId);
  return taskId ? isTaskMember(taskId, profileId) : false;
}
