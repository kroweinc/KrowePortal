"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { getProjectById } from "@/lib/actions/projects";
import { extractTranscriptText } from "@/lib/sop/extract-text";
import {
  MAX_ATTACHMENT_SIZE,
  MAX_SOP_CHARS,
  SOP_ALLOWED_EXTENSIONS,
} from "@/lib/attachments-constants";
import type { ProjectSopTranscript } from "@/lib/types";

// SOP originals reuse the project-materials bucket. The 0042 storage policy
// authorizes on (storage.foldername(name))[2] = <project_id> + owner, which the
// deeper projects/<project_id>/sop/<uuid>.<ext> path still satisfies.
const BUCKET = "project-materials";

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : await createClient();
}

function getExt(fileName: string): string {
  return "." + (fileName.split(".").pop()?.toLowerCase() ?? "bin");
}

async function assertProjectOwner(projectId: string, profileId: string): Promise<boolean> {
  const project = await getProjectById(projectId);
  return !!project && project.owner_id === profileId;
}

// Derive a friendly label from a filename: strip the extension, keep it short.
function labelFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").trim();
  return (base || fileName).slice(0, 200);
}

export async function getProjectSopTranscripts(
  projectId: string
): Promise<ProjectSopTranscript[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];

  const supabase = await getClient(profile.id);
  const { data } = await supabase
    .from("project_sop_transcripts")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  return (data ?? []) as ProjectSopTranscript[];
}

const addTextSchema = z.object({
  projectId: z.string().uuid(),
  content: z.string().trim().min(1, "Paste the transcript text.").max(MAX_SOP_CHARS, "Transcript is too long."),
  label: z.string().trim().max(200).optional(),
});

export async function addSopTranscriptText(
  projectId: string,
  content: string,
  label?: string
): Promise<{ success?: boolean; transcript?: ProjectSopTranscript; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders can add transcripts." };

  const parsed = addTextSchema.safeParse({ projectId, content, label: label || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  if (!(await assertProjectOwner(parsed.data.projectId, profile.id))) {
    return { error: "Not your document." };
  }

  const text = parsed.data.content;
  const supabase = await getClient(profile.id);
  const { data, error } = await supabase
    .from("project_sop_transcripts")
    .insert({
      project_id: parsed.data.projectId,
      uploaded_by: profile.id,
      source_type: "paste",
      label: parsed.data.label || "Pasted transcript",
      content: text,
      char_count: text.length,
    })
    .select("*")
    .single();

  if (error) return { error: error.message };

  revalidatePath(`/b/projects/${parsed.data.projectId}`);
  return { success: true, transcript: data as ProjectSopTranscript };
}

const uploadSchema = z.object({ project_id: z.string().uuid() });

export async function uploadSopTranscript(
  formData: FormData
): Promise<{ success?: boolean; transcript?: ProjectSopTranscript; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders can add transcripts." };

  const parsed = uploadSchema.safeParse({ project_id: formData.get("project_id") });
  if (!parsed.success) return { error: "Invalid document ID." };

  const projectId = parsed.data.project_id;
  if (!(await assertProjectOwner(projectId, profile.id))) return { error: "Not your document." };

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "No file provided." };
  if (file.size === 0) return { error: "File is empty." };
  if (file.size > MAX_ATTACHMENT_SIZE) return { error: "File exceeds 25 MB limit." };

  const ext = getExt(file.name);
  if (!SOP_ALLOWED_EXTENSIONS.has(ext)) {
    return { error: "Unsupported transcript type. Use .txt, .md, .vtt, .srt, .csv, .pdf, or .docx." };
  }

  // Extract the readable text first — a file we can't read shouldn't be stored.
  const extracted = await extractTranscriptText(file);
  if ("error" in extracted) return { error: extracted.error };
  const text = extracted.text.slice(0, MAX_SOP_CHARS);

  const storagePath = `projects/${projectId}/sop/${crypto.randomUUID()}${ext}`;
  const supabase = await getClient(profile.id);

  const { error: storageError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, { contentType: file.type || "application/octet-stream" });
  if (storageError) return { error: storageError.message };

  const { data, error: dbError } = await supabase
    .from("project_sop_transcripts")
    .insert({
      project_id: projectId,
      uploaded_by: profile.id,
      source_type: "file",
      label: labelFromFileName(file.name),
      file_name: file.name,
      storage_path: storagePath,
      mime_type: file.type || "application/octet-stream",
      content: text,
      char_count: text.length,
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
  return { success: true, transcript: data as ProjectSopTranscript };
}

const idSchema = z.object({ id: z.string().uuid() });

export async function deleteSopTranscript(
  transcriptId: string
): Promise<{ success?: boolean; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = idSchema.safeParse({ id: transcriptId });
  if (!parsed.success) return { error: "Invalid ID." };

  const supabase = await getClient(profile.id);
  const { data: transcript } = await supabase
    .from("project_sop_transcripts")
    .select("project_id, storage_path, source_type")
    .eq("id", parsed.data.id)
    .single();
  if (!transcript) return { error: "Transcript not found." };
  if (!(await assertProjectOwner(transcript.project_id as string, profile.id))) {
    return { error: "Not your document." };
  }

  // Granola imports are deduped through the granola_imports ledger; drop the
  // ledger row with the transcript so the call can be imported again.
  if (transcript.source_type === "granola") {
    await supabase.from("granola_imports").delete().eq("sop_transcript_id", parsed.data.id);
  }

  const { error } = await supabase
    .from("project_sop_transcripts")
    .delete()
    .eq("id", parsed.data.id);
  if (error) return { error: error.message };

  if (transcript.storage_path) {
    const adminClient = createAdminClient();
    await adminClient.storage.from(BUCKET).remove([transcript.storage_path as string]);
  }

  revalidatePath(`/b/projects/${transcript.project_id}`);
  return { success: true };
}

export async function getSopTranscriptSignedUrl(
  transcriptId: string
): Promise<{ url?: string; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Unauthorized" };

  const supabase = await getClient(profile.id);
  const { data: transcript } = await supabase
    .from("project_sop_transcripts")
    .select("project_id, storage_path")
    .eq("id", transcriptId)
    .single();
  if (!transcript || !transcript.storage_path) return { error: "Not found" };
  if (!(await assertProjectOwner(transcript.project_id as string, profile.id))) {
    return { error: "Unauthorized" };
  }

  const adminClient = createAdminClient();
  const { data, error } = await adminClient.storage
    .from(BUCKET)
    .createSignedUrl(transcript.storage_path as string, 60);
  if (error) return { error: error.message };
  return { url: data.signedUrl };
}
