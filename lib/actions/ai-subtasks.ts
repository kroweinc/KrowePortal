"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { redirect } from "next/navigation";
import { generateSubtasks } from "@/lib/ai/generate-subtasks";
import { assertAiBudget } from "@/lib/ai/usage";
import { resolveRepoForGeneration } from "@/lib/github/resolve-repo";
import { recomputeTaskEstimate } from "@/lib/actions/recompute-task-estimate";
import type { Subtask } from "@/lib/types";
import type { GenerationResult } from "@/lib/ai/schemas";

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : createClient();
}

export async function generateSubtaskDrafts(input: {
  taskId: string;
  answers?: { questionId: string; answer: string }[];
}): Promise<GenerationResult | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await getClient(profile.id);

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id, title, description, engagement_id")
    .eq("id", input.taskId)
    .single();

  if (taskError || !task) return { error: "Task not found" };

  const budget = await assertAiBudget(profile.id);
  if (!budget.ok) return { error: budget.error };

  const { data: attachments } = await supabase
    .from("task_attachments")
    .select("text_content")
    .eq("task_id", input.taskId)
    .eq("attachment_type", "text");

  const { repoContext, toolContext, source } = await resolveRepoForGeneration({
    profileId: profile.id,
    engagementId: task.engagement_id,
    logPrefix: "[generateSubtaskDrafts]",
  });

  console.log("[generateSubtaskDrafts] mode:", toolContext ? `tool-loop (${source})` : "one-shot");

  try {
    const result = await generateSubtasks({
      task: { title: task.title, description: task.description },
      repoContext,
      attachments: attachments ?? [],
      answers: input.answers,
      toolContext,
    }, { userId: profile.id, operation: "generate_subtasks" });
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI generation failed";
    return { error: msg };
  }
}

export async function acceptGeneratedSubtasks(
  taskId: string,
  drafts: { title: string; estLowMin: number; estHighMin: number }[]
): Promise<{ inserted: Subtask[]; error?: string }> {
  if (drafts.length === 0) return { inserted: [] };

  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await getClient(profile.id);

  const { data: maxRow } = await supabase
    .from("task_subtasks")
    .select("position")
    .eq("task_id", taskId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const start = (maxRow?.position ?? -1) + 1;

  const rows = drafts.map((d, i) => ({
    task_id: taskId,
    title: d.title.trim().slice(0, 300),
    completed: false,
    position: start + i,
    created_by: profile.id,
    ai_est_low_min: d.estLowMin,
    ai_est_high_min: d.estHighMin,
  }));

  const { data, error } = await supabase
    .from("task_subtasks")
    .insert(rows)
    .select();

  if (error) return { inserted: [], error: error.message };

  await recomputeTaskEstimate(taskId);

  return { inserted: (data ?? []) as Subtask[] };
}
