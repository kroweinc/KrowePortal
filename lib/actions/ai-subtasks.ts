"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { redirect } from "next/navigation";
import { generateSubtasks } from "@/lib/ai/generate-subtasks";
import { buildRepoContext } from "@/lib/github/repo-context";
import { getUserGithubToken } from "@/lib/github/token";
import type { Subtask } from "@/lib/types";
import type { GenerationResult } from "@/lib/ai/schemas";

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : createClient();
}

type EngagementWithRepo = {
  github_repo_owner: string | null;
  github_repo_name: string | null;
  github_repo_full_name: string | null;
  github_default_branch: string | null;
};

export async function generateSubtaskDrafts(input: {
  taskId: string;
  answers?: { questionId: string; answer: string }[];
}): Promise<GenerationResult | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await getClient(profile.id);

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select(
      `id, title, description, engagement_id,
       engagements:engagement_id (
         github_repo_owner, github_repo_name,
         github_repo_full_name, github_default_branch
       )`
    )
    .eq("id", input.taskId)
    .single();

  if (taskError || !task) return { error: "Task not found" };

  const { data: attachments } = await supabase
    .from("task_attachments")
    .select("text_content")
    .eq("task_id", input.taskId)
    .eq("attachment_type", "text");

  const engagement = Array.isArray(task.engagements)
    ? (task.engagements[0] as EngagementWithRepo | undefined)
    : (task.engagements as EngagementWithRepo | null);

  let repoContext = null;

  if (
    engagement?.github_repo_owner &&
    engagement?.github_repo_name &&
    engagement?.github_default_branch
  ) {
    const token = await getUserGithubToken(profile.id);
    if (token) {
      try {
        repoContext = await buildRepoContext(
          token,
          engagement.github_repo_owner,
          engagement.github_repo_name,
          engagement.github_default_branch
        );
      } catch {
        // non-fatal — fall through to task-only generation
      }
    }
  }

  try {
    const result = await generateSubtasks({
      task: { title: task.title, description: task.description },
      repoContext,
      attachments: attachments ?? [],
      answers: input.answers,
    });
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI generation failed";
    return { error: msg };
  }
}

export async function acceptGeneratedSubtasks(
  taskId: string,
  drafts: { title: string }[]
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
    .single();

  const start = (maxRow?.position ?? -1) + 1;

  const rows = drafts.map((d, i) => ({
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
  return { inserted: (data ?? []) as Subtask[] };
}
