"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { TaskAttachment } from "@/lib/types";

const MAX_SIZE = 25 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg",
  ".pdf",
  ".txt", ".csv", ".md", ".json",
  ".html", ".htm",
  ".zip",
  ".docx", ".xlsx", ".pptx", ".doc", ".xls",
]);

function getExt(fileName: string): string {
  return "." + (fileName.split(".").pop()?.toLowerCase() ?? "bin");
}

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : createClient();
}

const uploadSchema = z.object({ task_id: z.string().uuid() });

export async function uploadAttachment(formData: FormData): Promise<{ success?: boolean; attachment?: TaskAttachment; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = uploadSchema.safeParse({ task_id: formData.get("task_id") });
  if (!parsed.success) return { error: "Invalid task ID" };

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "No file provided" };
  if (file.size === 0) return { error: "File is empty" };
  if (file.size > MAX_SIZE) return { error: "File exceeds 25 MB limit" };

  const ext = getExt(file.name);
  if (!ALLOWED_EXTENSIONS.has(ext)) return { error: "File type not allowed" };

  const storagePath = `tasks/${parsed.data.task_id}/${crypto.randomUUID()}${ext}`;
  const supabase = await getClient(profile.id);

  const { error: storageError } = await supabase.storage
    .from("task-attachments")
    .upload(storagePath, file, { contentType: file.type || "application/octet-stream" });

  if (storageError) return { error: storageError.message };

  const { data, error: dbError } = await supabase
    .from("task_attachments")
    .insert({
      task_id: parsed.data.task_id,
      uploaded_by: profile.id,
      file_name: file.name,
      storage_path: storagePath,
      mime_type: file.type || "application/octet-stream",
      size_bytes: file.size,
    })
    .select("*, uploader:profiles!uploaded_by(id, display_name, role)")
    .single();

  if (dbError) {
    const adminClient = createAdminClient();
    await adminClient.storage.from("task-attachments").remove([storagePath]);
    return { error: dbError.message };
  }

  revalidatePath(`/o/tasks/${parsed.data.task_id}`);
  revalidatePath(`/b/tasks/${parsed.data.task_id}`);
  return { success: true, attachment: data as TaskAttachment };
}

const deleteSchema = z.object({ id: z.string().uuid() });

export async function deleteAttachment(attachmentId: string): Promise<{ success?: boolean; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = deleteSchema.safeParse({ id: attachmentId });
  if (!parsed.success) return { error: "Invalid ID" };

  const supabase = await getClient(profile.id);

  const { data: attachment } = await supabase
    .from("task_attachments")
    .select("storage_path, task_id")
    .eq("id", parsed.data.id)
    .single();

  if (!attachment) return { error: "Attachment not found" };

  const { error: dbError } = await supabase
    .from("task_attachments")
    .delete()
    .eq("id", parsed.data.id);

  if (dbError) return { error: dbError.message };

  const adminClient = createAdminClient();
  await adminClient.storage.from("task-attachments").remove([attachment.storage_path]);

  revalidatePath(`/o/tasks/${attachment.task_id}`);
  revalidatePath(`/b/tasks/${attachment.task_id}`);
  return { success: true };
}

export async function getAttachmentSignedUrl(attachmentId: string): Promise<{ url?: string; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Unauthorized" };

  const supabase = await getClient(profile.id);
  const { data: attachment } = await supabase
    .from("task_attachments")
    .select("storage_path")
    .eq("id", attachmentId)
    .single();

  if (!attachment) return { error: "Not found" };

  const adminClient = createAdminClient();
  const { data, error } = await adminClient.storage
    .from("task-attachments")
    .createSignedUrl(attachment.storage_path, 60);

  if (error) return { error: error.message };
  return { url: data.signedUrl };
}
