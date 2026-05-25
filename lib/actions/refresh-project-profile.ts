"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth";
import { getUserGithubConnection } from "@/lib/github/token";
import { fetchRepoContext } from "@/lib/github/repo-context";
import { getProjectProfile } from "./generate-project-profile";

export type RefreshProjectProfileResult =
  | { ok: true }
  | { ok: false; reason: "not_authenticated" | "wrong_role" | "no_repo" | "fetch_failed" | "generation_failed" };

export async function refreshProjectProfile(): Promise<RefreshProjectProfileResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, reason: "not_authenticated" };
  if (profile.role !== "builder") return { ok: false, reason: "wrong_role" };

  const connection = await getUserGithubConnection(profile.id);
  if (!connection || !connection.selectedRepo) {
    return { ok: false, reason: "no_repo" };
  }

  const { owner, name, defaultBranch } = connection.selectedRepo;
  const ctx = await fetchRepoContext(connection.token, owner, name, defaultBranch);
  if (!ctx) return { ok: false, reason: "fetch_failed" };

  const toolContext = {
    token: connection.token,
    owner,
    repo: name,
    ref: defaultBranch,
  };

  const fresh = await getProjectProfile(ctx, toolContext, { forceRefresh: true });
  if (!fresh) return { ok: false, reason: "generation_failed" };

  revalidatePath("/b/github");
  return { ok: true };
}
