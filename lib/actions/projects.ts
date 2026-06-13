"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { normalizeUrl } from "@/lib/project/business-context";
import type { Project } from "@/lib/types";

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : await createClient();
}

function isValidUrl(u: string | null): u is string {
  return !!u && z.string().url().safeParse(u).success;
}

const createSchema = z.object({
  name: z.string().min(1, "Give the project a name.").max(200),
  prospectName: z.string().max(200).optional(),
  prospectEmail: z.string().email("Enter a valid email.").max(320).optional().or(z.literal("")),
  linkedinUrl: z.string().max(2000).optional(),
  websiteUrl: z.string().max(2000).optional(),
  liveUrl: z.string().max(2000).optional(),
  notes: z.string().max(20000).optional(),
  links: z
    .array(z.object({ url: z.string().min(1), label: z.string().max(200).optional() }))
    .max(50)
    .optional(),
});

// Returns the new project id (no redirect) so the client can finish uploading
// any pending file materials before navigating to the project.
export async function createProject(input: {
  name: string;
  prospectName?: string;
  prospectEmail?: string;
  linkedinUrl?: string;
  websiteUrl?: string;
  liveUrl?: string;
  notes?: string;
  links?: { url: string; label?: string }[];
}): Promise<{ id: string } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders can create documents." };

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid project input." };
  }

  const linkedinUrl = normalizeUrl(parsed.data.linkedinUrl);
  if (parsed.data.linkedinUrl?.trim() && !isValidUrl(linkedinUrl)) {
    return { error: "Enter a valid LinkedIn URL." };
  }
  const websiteUrl = normalizeUrl(parsed.data.websiteUrl);
  if (parsed.data.websiteUrl?.trim() && !isValidUrl(websiteUrl)) {
    return { error: "Enter a valid website URL." };
  }
  const liveUrl = normalizeUrl(parsed.data.liveUrl);
  if (parsed.data.liveUrl?.trim() && !isValidUrl(liveUrl)) {
    return { error: "Enter a valid live work URL." };
  }

  const supabase = await getClient(profile.id);
  const { data, error } = await supabase
    .from("projects")
    .insert({
      owner_id: profile.id,
      name: parsed.data.name,
      prospect_name: parsed.data.prospectName ?? null,
      prospect_email: parsed.data.prospectEmail || null,
      linkedin_url: linkedinUrl,
      website_url: websiteUrl,
      live_url: liveUrl,
      context: parsed.data.notes?.trim() || null,
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Failed to create project." };

  const projectId = data.id as string;

  // Persist any pasted link materials. Best-effort — invalid links are dropped
  // and a failed insert must never undo a successfully created project.
  const links = (parsed.data.links ?? [])
    .map((l) => ({ url: normalizeUrl(l.url), label: l.label?.trim() || null }))
    .filter((l): l is { url: string; label: string | null } => isValidUrl(l.url));
  if (links.length) {
    await supabase.from("project_materials").insert(
      links.map((l) => ({
        project_id: projectId,
        uploaded_by: profile.id,
        material_type: "link" as const,
        url: l.url,
        label: l.label,
      }))
    );
  }

  revalidatePath("/b/projects");
  return { id: projectId };
}

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  status: z.enum(["active", "won", "lost", "archived"]).optional(),
  prospectName: z.string().max(200).nullish(),
  prospectEmail: z.string().email().max(320).nullish().or(z.literal("")),
  linkedinUrl: z.string().max(2000).nullish(),
  websiteUrl: z.string().max(2000).nullish(),
  liveUrl: z.string().max(2000).nullish(),
  context: z.string().max(20000).nullish(),
});

export async function updateProject(
  id: string,
  updates: {
    name?: string;
    status?: Project["status"];
    prospectName?: string | null;
    prospectEmail?: string | null;
    linkedinUrl?: string | null;
    websiteUrl?: string | null;
    liveUrl?: string | null;
    context?: string | null;
  }
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can edit a document." };

  const parsed = updateSchema.safeParse(updates);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const supabase = await getClient(profile.id);

  const { data: before } = await supabase
    .from("projects")
    .select("owner_id")
    .eq("id", id)
    .single();
  if (!before) return { error: "Document not found." };
  if (before.owner_id !== profile.id) return { error: "Not your document." };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.status !== undefined) patch.status = parsed.data.status;
  if (parsed.data.prospectName !== undefined) patch.prospect_name = parsed.data.prospectName;
  if (parsed.data.prospectEmail !== undefined) patch.prospect_email = parsed.data.prospectEmail || null;
  if (parsed.data.linkedinUrl !== undefined) patch.linkedin_url = normalizeUrl(parsed.data.linkedinUrl);
  if (parsed.data.websiteUrl !== undefined) patch.website_url = normalizeUrl(parsed.data.websiteUrl);
  if (parsed.data.liveUrl !== undefined) patch.live_url = normalizeUrl(parsed.data.liveUrl);
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
  if (profile.role !== "builder") return { error: "Only the builder can delete a document." };

  const supabase = await getClient(profile.id);

  const { data: before } = await supabase
    .from("projects")
    .select("owner_id")
    .eq("id", id)
    .single();
  if (!before) return { error: "Document not found." };
  if (before.owner_id !== profile.id) return { error: "Not your document." };

  // Child documents (prds/quotes/contracts) cascade via FK ON DELETE CASCADE.
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/b/projects");
  return { success: true };
}

export async function getProjects(): Promise<Project[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];

  const supabase = await getClient(profile.id);
  // Scope to the owner explicitly. RLS (owner_id = auth.uid()) does this for the
  // normal client, but the dev admin client bypasses RLS — without this filter a
  // dev identity would list every owner's projects and then fail ownership-guarded
  // mutations ("Not your document.") on rows it can see but doesn't own.
  const { data } = await supabase
    .from("projects")
    .select("*")
    .eq("owner_id", profile.id)
    .order("created_at", { ascending: false });

  return (data ?? []) as Project[];
}

export async function getProjectById(id: string): Promise<Project | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const supabase = await getClient(profile.id);
  // Owner-scoped: the dev admin client bypasses RLS, so a non-owner (or a dev
  // identity) must not be able to open another owner's project by id.
  const { data } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .eq("owner_id", profile.id)
    .maybeSingle();

  return (data ?? null) as Project | null;
}
