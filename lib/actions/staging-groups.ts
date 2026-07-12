"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { isEngagementMember, isTaskMember } from "@/lib/actions/task-access";
import type { StagingGroup } from "@/lib/types";

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : createClient();
}

const GROUP_COLUMNS = "id, engagement_id, name, sort_order, created_at";

/** Staging groups for one engagement, oldest-first (creation order). */
export async function getStagingGroups(
  engagementId: string
): Promise<StagingGroup[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];
  if (!(await isEngagementMember(engagementId, profile.id))) return [];

  const supabase = await getClient(profile.id);
  const { data } = await supabase
    .from("staging_groups")
    .select(GROUP_COLUMNS)
    .eq("engagement_id", engagementId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  return (data ?? []) as StagingGroup[];
}

/**
 * Batch-load staging groups for a set of engagements, keyed by engagement id —
 * so the builder server pages can preload them for the detail sheet in one
 * query. Read-only; empty for engagements with no groups.
 */
export async function getStagingGroupsByEngagement(
  engagementIds: string[]
): Promise<Record<string, StagingGroup[]>> {
  const profile = await getCurrentProfile();
  if (!profile || engagementIds.length === 0) return {};

  const supabase = await getClient(profile.id);
  const { data } = await supabase
    .from("staging_groups")
    .select(GROUP_COLUMNS)
    .in("engagement_id", engagementIds)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const out: Record<string, StagingGroup[]> = {};
  for (const g of (data ?? []) as StagingGroup[]) {
    (out[g.engagement_id] ??= []).push(g);
  }
  return out;
}

const createSchema = z.object({
  engagementId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
});

/** Create a named staging group on an engagement (builder-only via RLS). */
export async function createStagingGroup(
  engagementId: string,
  name: string
): Promise<{ group: StagingGroup } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = createSchema.safeParse({ engagementId, name });
  if (!parsed.success) return { error: "Enter a group name (1–80 characters)." };
  if (!(await isEngagementMember(engagementId, profile.id)))
    return { error: "You don't have access to this engagement." };

  const supabase = await getClient(profile.id);
  const { data, error } = await supabase
    .from("staging_groups")
    .insert({
      engagement_id: engagementId,
      name: parsed.data.name,
      created_by: profile.id,
    })
    .select(GROUP_COLUMNS)
    .single();

  if (error) return { error: error.message };

  revalidatePath("/b");
  revalidatePath("/b/staging");
  return { group: data as StagingGroup };
}

const renameSchema = z.object({
  groupId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
});

/** Rename a staging group. */
export async function renameStagingGroup(
  groupId: string,
  name: string
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = renameSchema.safeParse({ groupId, name });
  if (!parsed.success) return { error: "Enter a group name (1–80 characters)." };

  const supabase = await getClient(profile.id);
  const { data: group } = await supabase
    .from("staging_groups")
    .select("engagement_id")
    .eq("id", groupId)
    .maybeSingle();
  if (!group) return { error: "Group not found." };
  if (!(await isEngagementMember(group.engagement_id as string, profile.id)))
    return { error: "You don't have access to this group." };

  const { error } = await supabase
    .from("staging_groups")
    .update({ name: parsed.data.name })
    .eq("id", groupId);
  if (error) return { error: error.message };

  revalidatePath("/b");
  revalidatePath("/b/staging");
  return { success: true };
}

/** Delete a staging group. Tasks in it are un-assigned via ON DELETE SET NULL. */
export async function deleteStagingGroup(
  groupId: string
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  if (!z.string().uuid().safeParse(groupId).success)
    return { error: "Invalid group." };

  const supabase = await getClient(profile.id);
  const { data: group } = await supabase
    .from("staging_groups")
    .select("engagement_id")
    .eq("id", groupId)
    .maybeSingle();
  if (!group) return { error: "Group not found." };
  if (!(await isEngagementMember(group.engagement_id as string, profile.id)))
    return { error: "You don't have access to this group." };

  const { error } = await supabase.from("staging_groups").delete().eq("id", groupId);
  if (error) return { error: error.message };

  revalidatePath("/b");
  revalidatePath("/b/staging");
  return { success: true };
}

/**
 * Assign a task to a staging group (or clear it with null). Guards that the
 * group belongs to the task's own engagement so a task can't be filed under a
 * group from a different client.
 */
export async function assignTaskStagingGroup(
  taskId: string,
  groupId: string | null
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  if (!z.string().uuid().safeParse(taskId).success)
    return { error: "Invalid task." };
  if (groupId !== null && !z.string().uuid().safeParse(groupId).success)
    return { error: "Invalid group." };
  if (!(await isTaskMember(taskId, profile.id)))
    return { error: "You don't have access to this task." };

  const supabase = await getClient(profile.id);

  if (groupId !== null) {
    const { data: task } = await supabase
      .from("tasks")
      .select("engagement_id")
      .eq("id", taskId)
      .maybeSingle();
    const { data: group } = await supabase
      .from("staging_groups")
      .select("engagement_id")
      .eq("id", groupId)
      .maybeSingle();
    if (!task || !group) return { error: "Task or group not found." };
    if (task.engagement_id !== group.engagement_id)
      return { error: "That group belongs to a different engagement." };
  }

  const { error } = await supabase
    .from("tasks")
    .update({ staging_group_id: groupId, updated_at: new Date().toISOString() })
    .eq("id", taskId);
  if (error) return { error: error.message };

  revalidatePath("/b");
  revalidatePath("/b/staging");
  return { success: true };
}
