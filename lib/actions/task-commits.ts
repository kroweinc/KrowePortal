"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { writeAuditEntry } from "@/lib/actions/audit-log";
import { isTaskMember, isTaskCommitMember } from "@/lib/actions/task-access";

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : createClient();
}

const linkSchema = z.object({
  taskId: z.string().uuid(),
  commit: z.object({
    sha: z.string().min(7).max(64),
    url: z.string().url(),
    message: z.string().nullable(),
    author_name: z.string().nullable(),
    author_login: z.string().nullable(),
    committed_at: z.string().nullable(),
    repo_full_name: z.string().min(1),
  }),
});

export type LinkCommitInput = z.infer<typeof linkSchema>["commit"];

export async function linkTaskCommit(
  taskId: string,
  commit: LinkCommitInput
): Promise<{ id: string } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = linkSchema.safeParse({ taskId, commit });
  if (!parsed.success) return { error: "Invalid input" };
  if (!(await isTaskMember(taskId, profile.id)))
    return { error: "You don't have access to this task." };

  const supabase = await getClient(profile.id);

  const { data: existing } = await supabase
    .from("task_commits")
    .select("id")
    .eq("task_id", taskId)
    .eq("repo_full_name", commit.repo_full_name)
    .eq("commit_sha", commit.sha)
    .maybeSingle();

  if (existing?.id) {
    return { id: existing.id as string };
  }

  const { data, error } = await supabase
    .from("task_commits")
    .insert({
      task_id: taskId,
      repo_full_name: commit.repo_full_name,
      commit_sha: commit.sha,
      commit_url: commit.url,
      commit_message: commit.message,
      commit_author_name: commit.author_name,
      commit_author_login: commit.author_login,
      commit_committed_at: commit.committed_at,
      linked_by: profile.id,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  const shortSha = commit.sha.slice(0, 7);
  const firstLine = (commit.message ?? "").split("\n")[0].slice(0, 200);

  await writeAuditEntry({
    taskId,
    actorId: profile.id,
    action: "task.commit_linked",
    metadata: {
      sha: commit.sha,
      short_sha: shortSha,
      message: firstLine,
      url: commit.url,
      repo: commit.repo_full_name,
    },
  });

  revalidatePath("/b");
  revalidatePath("/o");
  return { id: data.id as string };
}

const unlinkSchema = z.object({ id: z.string().uuid() });

export async function unlinkTaskCommit(
  taskCommitId: string
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = unlinkSchema.safeParse({ id: taskCommitId });
  if (!parsed.success) return { error: "Invalid id" };
  if (!(await isTaskCommitMember(parsed.data.id, profile.id)))
    return { error: "You don't have access to this commit link." };

  const supabase = await getClient(profile.id);

  const { data: row } = await supabase
    .from("task_commits")
    .select("id, task_id, commit_sha, commit_message")
    .eq("id", parsed.data.id)
    .single();

  if (!row) return { error: "Not found" };

  const { error } = await supabase
    .from("task_commits")
    .delete()
    .eq("id", parsed.data.id);

  if (error) return { error: error.message };

  const shortSha = (row.commit_sha as string).slice(0, 7);
  const firstLine = ((row.commit_message as string | null) ?? "")
    .split("\n")[0]
    .slice(0, 200);

  await writeAuditEntry({
    taskId: row.task_id as string,
    actorId: profile.id,
    action: "task.commit_unlinked",
    metadata: {
      sha: row.commit_sha as string,
      short_sha: shortSha,
      message: firstLine,
    },
  });

  revalidatePath("/b");
  revalidatePath("/o");
  return { success: true };
}
