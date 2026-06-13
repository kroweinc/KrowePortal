"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { getProjectById } from "@/lib/actions/projects";
import { normalizeUrl } from "@/lib/project/business-context";
import { MAX_ATTACHMENT_SIZE, ALLOWED_ATTACHMENT_EXTENSIONS } from "@/lib/attachments-constants";
import type { ProjectMaterial } from "@/lib/types";

const BUCKET = "project-materials";

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : await createClient();
}

function getExt(fileName: string): string {
  return "." + (fileName.split(".").pop()?.toLowerCase() ?? "bin");
}

// Confirm the signed-in builder owns the project. Returns the owner id or null.
async function assertProjectOwner(projectId: string, profileId: string): Promise<boolean> {
  const project = await getProjectById(projectId);
  return !!project && project.owner_id === profileId;
}

export async function getProjectMaterials(projectId: string): Promise<ProjectMaterial[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];

  const supabase = await getClient(profile.id);
  const { data } = await supabase
    .from("project_materials")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  return (data ?? []) as ProjectMaterial[];
}

const uploadSchema = z.object({ project_id: z.string().uuid() });

export async function uploadProjectMaterial(
  formData: FormData
): Promise<{ success?: boolean; material?: ProjectMaterial; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders can add materials." };

  const parsed = uploadSchema.safeParse({ project_id: formData.get("project_id") });
  if (!parsed.success) return { error: "Invalid document ID." };

  const projectId = parsed.data.project_id;
  if (!(await assertProjectOwner(projectId, profile.id))) return { error: "Not your document." };

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "No file provided." };
  if (file.size === 0) return { error: "File is empty." };
  if (file.size > MAX_ATTACHMENT_SIZE) return { error: "File exceeds 25 MB limit." };

  const ext = getExt(file.name);
  if (!ALLOWED_ATTACHMENT_EXTENSIONS.has(ext)) return { error: "File type not allowed." };

  const storagePath = `projects/${projectId}/${crypto.randomUUID()}${ext}`;
  const supabase = await getClient(profile.id);

  const { error: storageError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, { contentType: file.type || "application/octet-stream" });
  if (storageError) return { error: storageError.message };

  const { data, error: dbError } = await supabase
    .from("project_materials")
    .insert({
      project_id: projectId,
      uploaded_by: profile.id,
      material_type: "file",
      file_name: file.name,
      storage_path: storagePath,
      mime_type: file.type || "application/octet-stream",
      size_bytes: file.size,
    })
    .select("*")
    .single();

  if (dbError) {
    // Roll back the orphaned object so storage doesn't drift from the table.
    const adminClient = createAdminClient();
    await adminClient.storage.from(BUCKET).remove([storagePath]);
    return { error: dbError.message };
  }

  revalidatePath(`/b/projects/${projectId}`);
  return { success: true, material: data as ProjectMaterial };
}

export async function addProjectMaterialLink(
  projectId: string,
  url: string,
  label?: string
): Promise<{ success?: boolean; material?: ProjectMaterial; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders can add materials." };

  const normalized = normalizeUrl(url);
  if (!normalized || !z.string().url().safeParse(normalized).success) {
    return { error: "Enter a valid URL." };
  }
  if (!(await assertProjectOwner(projectId, profile.id))) return { error: "Not your document." };

  const supabase = await getClient(profile.id);
  const { data, error } = await supabase
    .from("project_materials")
    .insert({
      project_id: projectId,
      uploaded_by: profile.id,
      material_type: "link",
      url: normalized,
      label: label?.trim() || null,
    })
    .select("*")
    .single();

  if (error) return { error: error.message };

  revalidatePath(`/b/projects/${projectId}`);
  return { success: true, material: data as ProjectMaterial };
}

const deleteSchema = z.object({ id: z.string().uuid() });

export async function deleteProjectMaterial(
  materialId: string
): Promise<{ success?: boolean; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = deleteSchema.safeParse({ id: materialId });
  if (!parsed.success) return { error: "Invalid ID." };

  const supabase = await getClient(profile.id);
  const { data: material } = await supabase
    .from("project_materials")
    .select("project_id, storage_path")
    .eq("id", parsed.data.id)
    .single();
  if (!material) return { error: "Material not found." };
  if (!(await assertProjectOwner(material.project_id as string, profile.id))) {
    return { error: "Not your document." };
  }

  const { error } = await supabase.from("project_materials").delete().eq("id", parsed.data.id);
  if (error) return { error: error.message };

  if (material.storage_path) {
    const adminClient = createAdminClient();
    await adminClient.storage.from(BUCKET).remove([material.storage_path as string]);
  }

  revalidatePath(`/b/projects/${material.project_id}`);
  return { success: true };
}

export async function getProjectMaterialSignedUrl(
  materialId: string
): Promise<{ url?: string; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Unauthorized" };

  const supabase = await getClient(profile.id);
  const { data: material } = await supabase
    .from("project_materials")
    .select("project_id, storage_path")
    .eq("id", materialId)
    .single();
  if (!material || !material.storage_path) return { error: "Not found" };
  if (!(await assertProjectOwner(material.project_id as string, profile.id))) {
    return { error: "Unauthorized" };
  }

  const adminClient = createAdminClient();
  const { data, error } = await adminClient.storage
    .from(BUCKET)
    .createSignedUrl(material.storage_path as string, 60);
  if (error) return { error: error.message };
  return { url: data.signedUrl };
}
