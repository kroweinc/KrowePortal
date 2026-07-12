"use server";

import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { generateTask } from "@/lib/ai/generate-tasks";
import { runTaskRegeneration } from "@/lib/ai/regenerate-task";
import { friendlyAiError } from "@/lib/ai/client";
import { assertAiBudget } from "@/lib/ai/usage";
import { resolveRepoForGeneration } from "@/lib/github/resolve-repo";
import { isTaskMember } from "@/lib/actions/task-access";
import {
  reconcileSubtaskPlan,
  subtaskLabel,
  type CurrentSubtask,
  type SubtaskReconciliation,
} from "@/lib/tasks/reconcile-subtask-plan";
import type { TaskOnlyResult } from "@/lib/ai/schemas";
import type { TaskTag } from "@/lib/types";

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : createClient();
}

const generateSchema = z.object({
  rawDescription: z.string().trim().min(5).max(5000),
  engagementId: z.string().uuid().optional(),
  // Q&A from the draft form's "strengthen" rounds. Capped at 5 — the UI hides
  // the affordance at the same limit, so hitting the cap here means a bad actor.
  clarifications: z
    .array(
      z.object({
        question: z.string().trim().min(1).max(300),
        answer: z.string().trim().min(1).max(1000),
      })
    )
    .max(5)
    .optional(),
});

export async function generateTaskDraft(input: {
  rawDescription: string;
  engagementId?: string;
  clarifications?: { question: string; answer: string }[];
}): Promise<TaskOnlyResult | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = generateSchema.safeParse(input);
  if (!parsed.success) return { error: "Please provide at least a few words describing what you want." };

  const budget = await assertAiBudget(profile.id);
  if (!budget.ok) return { error: budget.error };

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
      toolContext,
      clarifications: parsed.data.clarifications,
    }, { userId: profile.id, operation: "generate_tasks" });
    return result;
  } catch (err) {
    return { error: friendlyAiError(err) };
  }
}

// The reviewed rewrite the sidebar renders before it's applied: the revised task
// fields plus the reconciled subtask plan (kept / renamed / added / removed /
// preserved). No writes happen until applyTaskRegeneration in lib/actions/tasks.ts.
export interface TaskRegenerationProposal {
  task: {
    title: string;
    description: string;
    priority: "low" | "medium" | "high" | "urgent";
    type: "feature" | "bug" | "change";
    tags: TaskTag[];
    assumptions: string[];
  };
  reconciliation: SubtaskReconciliation;
  /** False when the task had no subtasks — the UI then hides the subtask diff. */
  hadSubtasks: boolean;
}

const regenerateSchema = z.object({
  taskId: z.string().uuid(),
  changeNote: z.string().trim().min(3).max(1000),
});

/**
 * Regenerate an existing task from a builder's "what changed" note: rewrite the
 * task (title/description/priority/type/tag) and reconcile its subtasks against
 * the change. Read-only — returns a proposal the sidebar previews; the builder
 * applies it via applyTaskRegeneration. Builder-only, budget-gated, repo-aware.
 */
export async function regenerateTask(
  taskId: string,
  changeNote: string
): Promise<{ proposal: TaskRegenerationProposal } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders can regenerate tasks." };

  const parsed = regenerateSchema.safeParse({ taskId, changeNote });
  if (!parsed.success) return { error: "Describe what changed in a few words to regenerate." };

  if (!(await isTaskMember(parsed.data.taskId, profile.id)))
    return { error: "You don't have access to this task." };

  const budget = await assertAiBudget(profile.id);
  if (!budget.ok) return { error: budget.error };

  const supabase = await getClient(profile.id);
  const { data: task } = await supabase
    .from("tasks")
    .select("title, description, priority, type, tags, engagement_id")
    .eq("id", parsed.data.taskId)
    .single();
  if (!task) return { error: "Task not found." };

  const { data: subtaskRows } = await supabase
    .from("task_subtasks")
    .select("id, title, completed, position, actual_hours")
    .eq("task_id", parsed.data.taskId)
    .order("position", { ascending: true });

  const current: CurrentSubtask[] = (subtaskRows ?? []).map((s) => ({
    id: s.id as string,
    title: s.title as string,
    completed: !!s.completed,
    actualHours: (s.actual_hours as number | null) ?? null,
  }));
  const hadSubtasks = current.length > 0;
  const engagementId = (task.engagement_id as string | null) ?? null;

  const { repoContext, toolContext, source } = await resolveRepoForGeneration({
    profileId: profile.id,
    engagementId: engagementId ?? undefined,
    logPrefix: "[regenerateTask]",
  });
  console.log("[regenerateTask] mode:", toolContext ? `tool-loop (${source})` : "one-shot");

  let result;
  try {
    result = await runTaskRegeneration(
      {
        current: {
          title: task.title as string,
          description: (task.description as string | null) ?? null,
          priority: task.priority as string,
          type: (task.type as string | null) ?? null,
          tags: (task.tags as string[] | null) ?? [],
        },
        subtasks: current.map((s, i) => ({
          label: subtaskLabel(i),
          title: s.title,
          completed: s.completed,
        })),
        changeNote: parsed.data.changeNote,
        repoContext,
        toolContext,
      },
      { userId: profile.id, operation: "regenerate_task", engagementId }
    );
  } catch (err) {
    return { error: friendlyAiError(err) };
  }

  // A task that had no subtasks gets none invented — reconcile only against what
  // existed, so the preview never surprises the builder with a fresh checklist.
  const reconciliation: SubtaskReconciliation = hadSubtasks
    ? reconcileSubtaskPlan(current, result.subtasks)
    : { final: [], remove: [] };

  return {
    proposal: {
      task: {
        title: result.task.title,
        description: result.task.description,
        priority: result.task.priority,
        type: result.task.type,
        tags: result.task.tags,
        assumptions: result.task.assumptions,
      },
      reconciliation,
      hadSubtasks,
    },
  };
}
