"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { redirect } from "next/navigation";
import { generateSubtasks } from "@/lib/ai/generate-subtasks";
import { assertAiBudget } from "@/lib/ai/usage";
import { resolveRepoForGeneration } from "@/lib/github/resolve-repo";
import { recomputeTaskEstimate } from "@/lib/actions/recompute-task-estimate";
import { isTaskMember } from "@/lib/actions/task-access";
import type { Subtask } from "@/lib/types";

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : createClient();
}

/**
 * Generate subtasks for a task with AI and persist them. Reads the task and its
 * linked repo, asks the model for a flat ordered breakdown, then appends the
 * results to the task's existing subtasks (positions continue from the end).
 * Returns the freshly inserted rows so the client can append them optimistically.
 */
export async function generateSubtasksForTask(
  taskId: string
): Promise<{ inserted: Subtask[]; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!(await isTaskMember(taskId, profile.id)))
    return { inserted: [], error: "You don't have access to this task." };

  const supabase = await getClient(profile.id);

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id, title, description, engagement_id")
    .eq("id", taskId)
    .single();

  if (taskError || !task) return { inserted: [], error: "Task not found" };

  const budget = await assertAiBudget(profile.id);
  if (!budget.ok) return { inserted: [], error: budget.error };

  const { repoContext, toolContext, source } = await resolveRepoForGeneration({
    profileId: profile.id,
    engagementId: task.engagement_id,
    logPrefix: "[generateSubtasksForTask]",
  });

  console.log(
    "[generateSubtasksForTask] mode:",
    toolContext ? `tool-loop (${source})` : "one-shot"
  );

  let result;
  try {
    result = await generateSubtasks(
      {
        task: { title: task.title, description: task.description },
        repoContext,
        toolContext,
      },
      { userId: profile.id, operation: "generate_subtasks" }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI generation failed";
    return { inserted: [], error: msg };
  }

  if (result.items.length === 0) return { inserted: [] };

  const { data: maxRow } = await supabase
    .from("task_subtasks")
    .select("position")
    .eq("task_id", taskId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const start = (maxRow?.position ?? -1) + 1;

  const rows = result.items.map((d, i) => ({
    task_id: taskId,
    title: d.title.trim().slice(0, 300),
    completed: false,
    position: start + i,
    created_by: profile.id,
  }));

  const { data, error } = await supabase
    .from("task_subtasks")
    .insert(rows)
    .select();

  if (error) return { inserted: [], error: error.message };

  await recomputeTaskEstimate(taskId);

  return { inserted: (data ?? []) as Subtask[] };
}
