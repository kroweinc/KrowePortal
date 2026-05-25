"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { resolveRepoForGeneration } from "@/lib/github/resolve-repo";
import {
  generateBuildPrompt,
  type BuildPromptResult,
  type AgentVariant,
} from "@/lib/ai/build-prompt";

const inputSchema = z.object({
  taskId: z.string().uuid(),
  variant: z.enum(["claude-code", "cursor", "chatgpt"]),
});

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : createClient();
}

export type GenerateBuildPromptActionResult =
  | { ok: true; result: BuildPromptResult; repoFullName: string; generatedAt: string }
  | { ok: false; error: string; needsRepo?: boolean };

export async function generateBuildPromptAction(
  taskId: string,
  variant: AgentVariant
): Promise<GenerateBuildPromptActionResult> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = inputSchema.safeParse({ taskId, variant });
  if (!parsed.success) {
    return { ok: false, error: "Invalid input" };
  }

  const supabase = await getClient(profile.id);

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id, title, description, priority, engagement_id")
    .eq("id", parsed.data.taskId)
    .single();
  if (taskError || !task) return { ok: false, error: "Task not found" };

  const [{ data: subtasks }, { data: attachments }] = await Promise.all([
    supabase
      .from("task_subtasks")
      .select("title, position")
      .eq("task_id", parsed.data.taskId)
      .order("position", { ascending: true }),
    supabase
      .from("task_attachments")
      .select("text_content, file_name, attachment_type, url")
      .eq("task_id", parsed.data.taskId),
  ]);

  const { repoContext, toolContext } = await resolveRepoForGeneration({
    profileId: profile.id,
    engagementId: task.engagement_id,
    logPrefix: "[generateBuildPromptAction]",
  });

  if (!repoContext || !toolContext) {
    return {
      ok: false,
      needsRepo: true,
      error:
        "No GitHub repo is connected for this task. Connect a repo in GitHub settings or on the engagement.",
    };
  }

  try {
    const result = await generateBuildPrompt({
      task: {
        title: task.title as string,
        description: (task.description as string | null) ?? null,
        priority: task.priority,
      },
      subtasks: (subtasks ?? []).map((s) => ({ title: s.title as string })),
      attachments: (attachments ?? []).map((a) => ({
        text_content: (a.text_content as string | null) ?? null,
        file_name: a.file_name as string,
        attachment_type: a.attachment_type,
        url: (a.url as string | null) ?? null,
      })),
      repoContext,
      toolContext,
      variant: parsed.data.variant,
    });

    const generatedAt = new Date().toISOString();

    const { error: upsertError } = await supabase
      .from("task_build_prompts")
      .upsert(
        {
          task_id: parsed.data.taskId,
          variant: parsed.data.variant,
          prompt: result.prompt,
          files_referenced: result.filesReferenced,
          notes: result.notes,
          repo_full_name: repoContext.fullName,
          generated_by: profile.id,
          generated_at: generatedAt,
        },
        { onConflict: "task_id,variant" }
      );

    if (upsertError) {
      console.error("[generateBuildPromptAction] upsert failed:", upsertError.message);
      // Non-fatal — still return the generated result so the user can copy it.
    }

    return {
      ok: true,
      result,
      repoFullName: repoContext.fullName,
      generatedAt,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to generate build prompt";
    return { ok: false, error: msg };
  }
}
