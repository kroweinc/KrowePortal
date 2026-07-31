"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { getClient, assertEngagementBuilder } from "@/lib/context/access";
import { extractTranscriptText } from "@/lib/sop/extract-text";
import { normalizeUrl } from "@/lib/project/business-context";
import { embedAndStoreChunks } from "@/lib/context/embed-store";
import { backfillProjectDocuments } from "@/lib/context/sync-document";
import {
  backfillEngagementEntities,
  backfillProjectScopedEntities,
} from "@/lib/context/sync-entity";
import { syncLinkContent, backfillLinkContents } from "@/lib/context/sync-link";
import {
  syncBuilderProfileContext,
  syncOperatorProfileContext,
} from "@/lib/context/sync-profile";
import {
  MAX_ATTACHMENT_SIZE,
  MAX_SOP_CHARS,
  SOP_ALLOWED_EXTENSIONS,
} from "@/lib/attachments-constants";
import type { ContextItem, ContextItemKind } from "@/lib/types";

// Files reuse the existing private project-materials bucket; the 0059 storage
// policy authorizes the engagements/<id>/context/… path for the engagement's builder.
const BUCKET = "project-materials";

// Document uploads must yield extractable text (it's what we chunk + embed), so
// the upload path accepts only the SOP-extractable formats, not the full set.
const UPLOAD_KINDS = new Set<ContextItemKind>(["document", "sop", "transcript", "material"]);

function getExt(fileName: string): string {
  return "." + (fileName.split(".").pop()?.toLowerCase() ?? "bin");
}

function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").trim();
  return (base || fileName).slice(0, 200);
}

function revalidateEngagement(engagementId: string) {
  revalidatePath(`/b/engagements/${engagementId}`);
}

export async function getContextItems(engagementId: string): Promise<ContextItem[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];
  if (!(await assertEngagementBuilder(engagementId, profile.id))) return [];

  const supabase = await getClient(profile.id);
  const { data } = await supabase
    .from("context_items")
    .select("*")
    .eq("engagement_id", engagementId)
    .order("created_at", { ascending: false });

  return (data ?? []) as ContextItem[];
}

/**
 * Mirror the engagement's project documents (PRD/quote/contract) into the
 * context layer if they aren't already, then return the refreshed item list.
 * Called by the Client Context panel on load so documents authored before this
 * sync — or drafted before the engagement was linked — show up automatically.
 * Builder-only; a no-op (just returns current items) when the engagement has no
 * linked project.
 */
export async function syncEngagementDocuments(
  engagementId: string
): Promise<{ items: ContextItem[] }> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "builder") return { items: [] };
  if (!(await assertEngagementBuilder(engagementId, profile.id))) return { items: [] };

  const admin = createAdminClient();
  const { data: eng } = await admin
    .from("engagements")
    .select("project_id")
    .eq("id", engagementId)
    .maybeSingle();

  if (eng?.project_id) {
    await backfillProjectDocuments(engagementId, eng.project_id as string, profile.id);
    await backfillProjectScopedEntities(engagementId, eng.project_id as string, profile.id);
  }

  // Mirror the two people in the engagement (builder + operator) and every
  // engagement-scoped entity (briefs, change orders, agreement, deliverables,
  // infra, tasks, milestones, availability) into the context layer too. All
  // engagement-level, so they run even without a linked project. Best-effort:
  // the helpers swallow their own errors.
  await Promise.all([
    syncBuilderProfileContext(engagementId, profile.id),
    syncOperatorProfileContext(engagementId, profile.id),
    backfillEngagementEntities(engagementId, profile.id),
    backfillLinkContents(engagementId, profile.id),
  ]);

  return { items: await getContextItems(engagementId) };
}

const noteSchema = z.object({
  engagementId: z.string().uuid(),
  title: z.string().trim().max(200).optional(),
  content: z.string().trim().min(1, "Add some text.").max(MAX_SOP_CHARS, "Note is too long."),
});

export async function addContextNote(
  engagementId: string,
  content: string,
  title?: string
): Promise<{ success?: boolean; item?: ContextItem; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders can add context." };

  const parsed = noteSchema.safeParse({ engagementId, content, title: title || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  if (!(await assertEngagementBuilder(parsed.data.engagementId, profile.id))) {
    return { error: "Not your client." };
  }

  const text = parsed.data.content;
  const supabase = await getClient(profile.id);
  const { data, error } = await supabase
    .from("context_items")
    .insert({
      engagement_id: parsed.data.engagementId,
      created_by: profile.id,
      kind: "note",
      title: parsed.data.title || "Note",
      content: text,
      char_count: text.length,
      source_meta: { source: "paste" },
    })
    .select("*")
    .single();

  if (error || !data) return { error: error?.message ?? "Couldn't save note." };

  await embedAndStoreChunks(data.id as string, parsed.data.engagementId, text, profile.id);
  revalidateEngagement(parsed.data.engagementId);
  return { success: true, item: data as ContextItem };
}

const linkSchema = z.object({
  engagementId: z.string().uuid(),
  url: z.string().trim().min(1, "Add a URL."),
  title: z.string().trim().max(200).optional(),
});

export async function addContextLink(
  engagementId: string,
  url: string,
  title?: string
): Promise<{ success?: boolean; item?: ContextItem; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders can add context." };

  const parsed = linkSchema.safeParse({ engagementId, url, title: title || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  if (!(await assertEngagementBuilder(parsed.data.engagementId, profile.id))) {
    return { error: "Not your client." };
  }

  const normalized = normalizeUrl(parsed.data.url);
  if (!normalized) return { error: "Enter a valid http(s) URL." };

  const supabase = await getClient(profile.id);
  // The link is stored immediately as a reference (status 'skipped'); then we
  // fetch + extract + embed its page content so it becomes searchable. The
  // fetch is best-effort (see syncLinkContent) and never blocks the save.
  const { data, error } = await supabase
    .from("context_items")
    .insert({
      engagement_id: parsed.data.engagementId,
      created_by: profile.id,
      kind: "link",
      title: parsed.data.title || new URL(normalized).host,
      url: normalized,
      embedding_status: "skipped",
      source_meta: { source: "link" },
    })
    .select("*")
    .single();

  if (error || !data) return { error: error?.message ?? "Couldn't save link." };

  await syncLinkContent(data.id as string, parsed.data.engagementId, normalized, profile.id);
  revalidateEngagement(parsed.data.engagementId);
  return { success: true, item: data as ContextItem };
}

const uploadSchema = z.object({
  engagement_id: z.string().uuid(),
  kind: z.enum(["document", "sop", "transcript", "material"]).default("document"),
});

export async function addContextDocument(
  formData: FormData
): Promise<{ success?: boolean; item?: ContextItem; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders can add context." };

  const parsed = uploadSchema.safeParse({
    engagement_id: formData.get("engagement_id"),
    kind: formData.get("kind") ?? undefined,
  });
  if (!parsed.success) return { error: "Invalid request." };
  const { engagement_id: engagementId, kind } = parsed.data;
  if (!UPLOAD_KINDS.has(kind)) return { error: "Unsupported context kind." };
  if (!(await assertEngagementBuilder(engagementId, profile.id))) return { error: "Not your client." };

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "No file provided." };
  if (file.size === 0) return { error: "File is empty." };
  if (file.size > MAX_ATTACHMENT_SIZE) return { error: "File exceeds 25 MB limit." };

  const ext = getExt(file.name);
  if (!SOP_ALLOWED_EXTENSIONS.has(ext)) {
    return { error: "Unsupported file type. Use .txt, .md, .vtt, .srt, .csv, .pdf, or .docx." };
  }

  // Extract text first — a file we can't read shouldn't be stored or embedded.
  const extracted = await extractTranscriptText(file);
  if ("error" in extracted) return { error: extracted.error };
  const text = extracted.text.slice(0, MAX_SOP_CHARS);

  const storagePath = `engagements/${engagementId}/context/${crypto.randomUUID()}${ext}`;
  const supabase = await getClient(profile.id);

  const { error: storageError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, { contentType: file.type || "application/octet-stream" });
  if (storageError) return { error: storageError.message };

  const { data, error: dbError } = await supabase
    .from("context_items")
    .insert({
      engagement_id: engagementId,
      created_by: profile.id,
      kind,
      title: titleFromFileName(file.name),
      file_name: file.name,
      storage_path: storagePath,
      mime_type: file.type || "application/octet-stream",
      size_bytes: file.size,
      content: text,
      char_count: text.length,
      source_meta: { source: "upload", original_ext: ext },
    })
    .select("*")
    .single();

  if (dbError || !data) {
    // Roll back the orphaned object so storage doesn't drift from the table.
    const admin = createAdminClient();
    await admin.storage.from(BUCKET).remove([storagePath]);
    return { error: dbError?.message ?? "Couldn't save document." };
  }

  await embedAndStoreChunks(data.id as string, engagementId, text, profile.id);
  revalidateEngagement(engagementId);
  return { success: true, item: data as ContextItem };
}

const idSchema = z.object({ id: z.string().uuid() });

export async function deleteContextItem(
  itemId: string
): Promise<{ success?: boolean; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = idSchema.safeParse({ id: itemId });
  if (!parsed.success) return { error: "Invalid ID." };

  const supabase = await getClient(profile.id);
  const { data: item } = await supabase
    .from("context_items")
    .select("engagement_id, storage_path")
    .eq("id", parsed.data.id)
    .single();
  if (!item) return { error: "Item not found." };
  if (!(await assertEngagementBuilder(item.engagement_id as string, profile.id))) {
    return { error: "Not your client." };
  }

  // Chunks cascade via the context_chunks FK.
  const { error } = await supabase.from("context_items").delete().eq("id", parsed.data.id);
  if (error) return { error: error.message };

  if (item.storage_path) {
    const admin = createAdminClient();
    await admin.storage.from(BUCKET).remove([item.storage_path as string]);
  }

  revalidateEngagement(item.engagement_id as string);
  return { success: true };
}

export async function getContextItemSignedUrl(
  itemId: string
): Promise<{ url?: string; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Unauthorized" };

  const supabase = await getClient(profile.id);
  const { data: item } = await supabase
    .from("context_items")
    .select("engagement_id, storage_path")
    .eq("id", itemId)
    .single();
  if (!item || !item.storage_path) return { error: "Not found" };
  if (!(await assertEngagementBuilder(item.engagement_id as string, profile.id))) {
    return { error: "Unauthorized" };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(item.storage_path as string, 60);
  if (error) return { error: error.message };
  return { url: data.signedUrl };
}
