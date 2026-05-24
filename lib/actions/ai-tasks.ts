"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { generateTask } from "@/lib/ai/generate-tasks";
import { resolveRepoForGeneration } from "@/lib/github/resolve-repo";
import { recomputeTaskEstimate } from "@/lib/actions/recompute-task-estimate";
import { estimateAndSaveTaskHours } from "@/lib/actions/estimate-task";
import type { TaskGenerationResult } from "@/lib/ai/schemas";
import type { TaskPriority } from "@/lib/types";

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : createClient();
}

const generateSchema = z.object({
  rawDescription: z.string().trim().min(5).max(5000),
  engagementId: z.string().uuid().optional(),
  answers: z
    .array(z.object({ questionId: z.string(), answer: z.string() }))
    .optional(),
});

export async function generateTaskDraft(input: {
  rawDescription: string;
  engagementId?: string;
  answers?: { questionId: string; answer: string }[];
}): Promise<TaskGenerationResult | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = generateSchema.safeParse(input);
  if (!parsed.success) return { error: "Please provide at least a few words describing what you want." };

  const { repoContext, toolContext, source } = await resolveRepoForGeneration({
    profileId: profile.id,
    engagementId: parsed.data.engagementId,
    logPrefix: "[generateTaskDraft]",
  });

  console.log("[generateTaskDraft] mode:", toolContext ? `tool-loop (${source})` : "one-shot");

  try {
    const result = await generateTask({
      rawDescription: parsed.data.rawDescription,
      repoContext,
      answers: parsed.data.answers,
      toolContext,
    });
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI generation failed";
    return { error: msg };
  }
}

const acceptSchema = z.object({
  engagementId: z.string().uuid().optional(),
  task: z.object({
    title: z.string().min(1).max(300),
    description: z.string().max(2000).optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]),
  }),
  subtasks: z
    .array(
      z.object({
        title: z.string().min(1).max(300),
        estLowMin: z.number().int().min(1).max(4800).nullable().optional(),
        estHighMin: z.number().int().min(1).max(4800).nullable().optional(),
      })
    )
    .max(20),
});

export async function acceptGeneratedTask(input: {
  engagementId?: string;
  task: { title: string; description?: string; priority: TaskPriority };
  subtasks: { title: string; estLowMin?: number | null; estHighMin?: number | null }[];
}): Promise<{ taskId: string } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = acceptSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await getClient(profile.id);

  const { data: taskRow, error: taskError } = await supabase
    .from("tasks")
    .insert({
      engagement_id: parsed.data.engagementId ?? null,
      title: parsed.data.task.title,
      description: parsed.data.task.description ?? null,
      priority: parsed.data.task.priority,
      source: profile.role === "operator" ? "operator_request" : "builder_added",
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (taskError || !taskRow) return { error: taskError?.message ?? "Failed to create task" };

  const taskId = taskRow.id as string;

  const hasSubtaskEstimates = parsed.data.subtasks.some(
    (s) => s.estLowMin != null && s.estHighMin != null
  );

  if (parsed.data.subtasks.length > 0) {
    const rows = parsed.data.subtasks.map((s, i) => ({
      task_id: taskId,
      title: s.title.trim().slice(0, 300),
      completed: false,
      position: i,
      created_by: profile.id,
      ai_est_low_min: s.estLowMin ?? null,
      ai_est_high_min: s.estHighMin ?? null,
    }));

    const { error: subtaskError } = await supabase.from("task_subtasks").insert(rows);
    if (subtaskError) {
      console.error("[acceptGeneratedTask] subtask insert failed:", subtaskError.message);
    } else if (hasSubtaskEstimates) {
      await recomputeTaskEstimate(taskId);
    }
  }

  if (!hasSubtaskEstimates) {
    await estimateAndSaveTaskHours({
      taskId,
      title: parsed.data.task.title,
      description: parsed.data.task.description ?? null,
      priority: parsed.data.task.priority,
    });
  }

  revalidatePath("/b");
  revalidatePath("/o");
  return { taskId };
}
