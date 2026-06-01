"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import type { Project } from "@/lib/types";

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : await createClient();
}

const createSchema = z.object({
  name: z.string().min(1, "Give the project a name.").max(200),
  prospectName: z.string().max(200).optional(),
  prospectEmail: z.string().email("Enter a valid email.").max(320).optional().or(z.literal("")),
  context: z.string().max(20000).optional(),
});

export async function createProject(
  formData: FormData
): Promise<{ error: string } | void> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders can create projects." };

  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    prospectName: formData.get("prospectName") || undefined,
    prospectEmail: formData.get("prospectEmail") || undefined,
    context: formData.get("context") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid project input." };
  }

  const supabase = await getClient(profile.id);
  const { data, error } = await supabase
    .from("projects")
    .insert({
      owner_id: profile.id,
      name: parsed.data.name,
      prospect_name: parsed.data.prospectName ?? null,
      prospect_email: parsed.data.prospectEmail || null,
      context: parsed.data.context ?? null,
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Failed to create project." };

  revalidatePath("/b/projects");
  redirect(`/b/projects/${data.id as string}`);
}

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  status: z.enum(["active", "won", "lost", "archived"]).optional(),
  prospectName: z.string().max(200).nullish(),
  prospectEmail: z.string().email().max(320).nullish().or(z.literal("")),
  context: z.string().max(20000).nullish(),
});

export async function updateProject(
  id: string,
  updates: {
    name?: string;
    status?: Project["status"];
    prospectName?: string | null;
    prospectEmail?: string | null;
    context?: string | null;
  }
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can edit a project." };

  const parsed = updateSchema.safeParse(updates);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const supabase = await getClient(profile.id);

  const { data: before } = await supabase
    .from("projects")
    .select("owner_id")
    .eq("id", id)
    .single();
  if (!before) return { error: "Project not found." };
  if (before.owner_id !== profile.id) return { error: "Not your project." };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.status !== undefined) patch.status = parsed.data.status;
  if (parsed.data.prospectName !== undefined) patch.prospect_name = parsed.data.prospectName;
  if (parsed.data.prospectEmail !== undefined) patch.prospect_email = parsed.data.prospectEmail || null;
  if (parsed.data.context !== undefined) patch.context = parsed.data.context;

  const { error } = await supabase.from("projects").update(patch).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/b/projects");
  revalidatePath(`/b/projects/${id}`);
  return { success: true };
}

export async function deleteProject(
  id: string
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can delete a project." };

  const supabase = await getClient(profile.id);

  const { data: before } = await supabase
    .from("projects")
    .select("owner_id")
    .eq("id", id)
    .single();
  if (!before) return { error: "Project not found." };
  if (before.owner_id !== profile.id) return { error: "Not your project." };

  // Child documents (briefs/prds/contracts) cascade via FK ON DELETE CASCADE.
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/b/projects");
  return { success: true };
}

export async function getProjects(): Promise<Project[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];

  const supabase = await getClient(profile.id);
  const { data } = await supabase
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false });

  return (data ?? []) as Project[];
}

export async function getProjectById(id: string): Promise<Project | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const supabase = await getClient(profile.id);
  const { data } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  return (data ?? null) as Project | null;
}
