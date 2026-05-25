"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { redirect } from "next/navigation";
import { z } from "zod";
import { recomputeTaskEstimate } from "@/lib/actions/recompute-task-estimate";
import { writeAuditEntry } from "@/lib/actions/audit-log";
import type { Subtask } from "@/lib/types";

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : createClient();
}

const titleSchema = z.string().min(1).max(300);

export async function createSubtask(
  taskId: string,
  title: string
): Promise<{ subtask?: Subtask; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsedTitle = titleSchema.safeParse(title.trim());
  if (!parsedTitle.success) return { error: "Title is required (max 300 chars)" };

  const supabase = await getClient(profile.id);

  const { data: maxRow } = await supabase
    .from("task_subtasks")
    .select("position")
    .eq("task_id", taskId)
    .order("position", { ascending: false })
    .limit(1)
    .single();

  const position = (maxRow?.position ?? -1) + 1;

  const { data, error } = await supabase
    .from("task_subtasks")
    .insert({
      task_id: taskId,
      created_by: profile.id,
      title: parsedTitle.data,
      position,
    })
    .select()
    .single();

  if (error) return { error: error.message };

  await writeAuditEntry({
    taskId,
    subtaskId: (data as Subtask).id,
    actorId: profile.id,
    action: "subtask.created",
    metadata: { title: parsedTitle.data },
  });

  await recomputeTaskEstimate(taskId);

  return { subtask: data as Subtask };
}

export async function toggleSubtask(
  id: string,
  completed: boolean
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await getClient(profile.id);

  const { data: before } = await supabase
    .from("task_subtasks")
    .select("task_id, title, completed")
    .eq("id", id)
    .single();

  const { error } = await supabase
    .from("task_subtasks")
    .update({ completed, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { error: error.message };

  if (before && before.completed !== completed) {
    await writeAuditEntry({
      taskId: before.task_id as string,
      subtaskId: id,
      actorId: profile.id,
      action: completed ? "subtask.completed" : "subtask.uncompleted",
      metadata: { title: before.title as string },
    });
  }
  return {};
}

export async function updateSubtaskTitle(
  id: string,
  title: string
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsedTitle = titleSchema.safeParse(title.trim());
  if (!parsedTitle.success) return { error: "Title is required (max 300 chars)" };

  const supabase = await getClient(profile.id);

  const { data: before } = await supabase
    .from("task_subtasks")
    .select("task_id, title")
    .eq("id", id)
    .single();

  const { error } = await supabase
    .from("task_subtasks")
    .update({ title: parsedTitle.data, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { error: error.message };

  if (before && before.title !== parsedTitle.data) {
    await writeAuditEntry({
      taskId: before.task_id as string,
      subtaskId: id,
      actorId: profile.id,
      action: "subtask.renamed",
      field: "title",
      oldValue: before.title,
      newValue: parsedTitle.data,
    });
  }
  return {};
}

export async function deleteSubtask(
  id: string,
  taskId: string
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await getClient(profile.id);

  const { data: before } = await supabase
    .from("task_subtasks")
    .select("title")
    .eq("id", id)
    .single();

  const { error } = await supabase.from("task_subtasks").delete().eq("id", id);

  if (error) return { error: error.message };

  await writeAuditEntry({
    taskId,
    actorId: profile.id,
    action: "subtask.deleted",
    metadata: { title: (before?.title as string | undefined) ?? null },
  });

  await recomputeTaskEstimate(taskId);

  return {};
}

export async function reorderSubtasks(
  updates: { id: string; position: number }[]
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await getClient(profile.id);
  const results = await Promise.all(
    updates.map(({ id, position }) =>
      supabase
        .from("task_subtasks")
        .update({ position, updated_at: new Date().toISOString() })
        .eq("id", id)
    )
  );

  const failed = results.find((r) => r.error);
  if (failed?.error) return { error: failed.error.message };
  return {};
}
