"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { isUniqueViolation } from "@/lib/supabase/errors";
import { findSimilarTitles, normalizeTitle } from "@/lib/tasks/dedupe";
import { getCurrentProfile } from "@/lib/auth";
import { getProjectById } from "@/lib/actions/projects";
import { estimateAndSaveTaskHours } from "@/lib/actions/estimate-task";
import { writeAuditEntries } from "@/lib/actions/audit-log";
import { getGranolaAccessToken } from "@/lib/granola/connection";
import {
  listNotes,
  listFolders,
  getNoteWithTranscript,
  transcriptToPlainText,
  GranolaAuthError,
  GranolaNotFoundError,
  GranolaRateLimitError,
} from "@/lib/granola/client";
import {
  getClient,
  granolaTargetSchema,
  assertEngagementBuilder,
  getImportedNoteIds,
  resolveGranolaDraft,
  gateTranscriptTaskDrafting,
  type GranolaImportTargetInput,
} from "@/lib/granola/draft-core";
import { stageTimer } from "@/lib/granola/timing";
import { extractTasksFromTranscript } from "@/lib/ai/extract-tasks-from-transcript";
import { extractTranscriptText } from "@/lib/sop/extract-text";
import { ExtractedTaskDraft } from "@/lib/ai/schemas";
import { friendlyAiError } from "@/lib/ai/client";
import { MAX_ATTACHMENT_SIZE, MAX_SOP_CHARS } from "@/lib/attachments-constants";
import type { ProjectSopTranscript } from "@/lib/types";

export type { GranolaImportTargetInput } from "@/lib/granola/draft-core";

export interface GranolaNoteListItem {
  id: string;
  title: string | null;
  createdAt: string | null;
  summarySnippet: string | null;
  alreadyImported: boolean;
}

export interface GranolaFolderItem {
  id: string;
  title: string;
  noteCount: number | null;
}

export type ListGranolaNotesResult =
  | { notConnected: true }
  | { keyInvalid: true }
  | { error: string }
  | {
      notes: GranolaNoteListItem[];
      cursor: string | null;
      hasMore: boolean;
      /** Present only when includeFolders was requested (dialog open/refresh).
          [] means the workspace has no folders or is on the free tier. */
      folders?: GranolaFolderItem[];
    };

async function assertTargetOwnership(
  target: GranolaImportTargetInput,
  profileId: string
): Promise<boolean> {
  if (target.kind === "project") {
    const project = await getProjectById(target.projectId);
    return !!project && project.owner_id === profileId;
  }
  return assertEngagementBuilder(target.engagementId, profileId);
}

const listOptionsSchema = z
  .object({
    folderId: z.string().min(1).max(200).optional(),
    includeFolders: z.boolean().optional(),
  })
  .optional();

export async function listGranolaNotesForImport(
  target: GranolaImportTargetInput,
  cursor?: string,
  options?: { folderId?: string; includeFolders?: boolean }
): Promise<ListGranolaNotesResult> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders can import from Granola." };

  const parsedTarget = granolaTargetSchema.safeParse(target);
  if (!parsedTarget.success) return { error: "Invalid import target." };
  const parsedOptions = listOptionsSchema.safeParse(options);
  if (!parsedOptions.success) return { error: "Invalid import target." };
  if (!(await assertTargetOwnership(parsedTarget.data, profile.id))) {
    return { error: "Not your document." };
  }

  const accessToken = await getGranolaAccessToken(profile.id);
  if (!accessToken) return { notConnected: true };

  try {
    // A folder hiccup should never block the call list, so it degrades to
    // "no filter row" instead of surfacing an error.
    const [page, folders] = await Promise.all([
      listNotes(accessToken, { cursor, pageSize: 30, folderId: parsedOptions.data?.folderId }),
      parsedOptions.data?.includeFolders
        ? listFolders(accessToken).catch(() => [])
        : Promise.resolve(undefined),
    ]);
    const imported = await getImportedNoteIds(
      parsedTarget.data,
      profile.id,
      page.notes.map((n) => n.id)
    );
    return {
      notes: page.notes.map((n) => ({
        id: n.id,
        title: n.title,
        createdAt: n.created_at,
        summarySnippet: n.summary ? n.summary.slice(0, 160) : null,
        alreadyImported: imported.has(n.id),
      })),
      cursor: page.cursor,
      hasMore: page.hasMore,
      ...(folders !== undefined && { folders }),
    };
  } catch (err) {
    if (err instanceof GranolaAuthError) return { keyInvalid: true };
    if (err instanceof GranolaRateLimitError) {
      return { error: "Granola is rate-limiting requests — wait a few seconds and try again." };
    }
    return { error: "Couldn't reach Granola. Try again in a moment." };
  }
}

/** Near-duplicate check for the review screen: for each drafted title, find the
    best-matching OPEN task already in the engagement. Returns a map keyed by the
    normalized draft title so the review UI can badge and default-uncheck likely
    duplicates. Read-only and ownership-gated; extraction stays stateless, so
    this is the layer that makes a re-recorded/overlapping call not silently
    re-create tasks that already exist. */
export async function matchExistingOpenTasks(input: {
  engagementId: string;
  titles: string[];
}): Promise<Record<string, { id: string; title: string }>> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "builder") return {};

  const parsed = z
    .object({
      engagementId: z.string().uuid(),
      titles: z.array(z.string().max(300)).max(40),
    })
    .safeParse(input);
  if (!parsed.success) return {};
  if (!(await assertEngagementBuilder(parsed.data.engagementId, profile.id))) return {};

  const supabase = await getClient(profile.id);
  const { data } = await supabase
    .from("tasks")
    .select("id, title, status")
    .eq("engagement_id", parsed.data.engagementId)
    .neq("status", "done");

  const candidates = (data ?? []).map((t) => ({ id: t.id as string, title: t.title as string }));
  if (candidates.length === 0) return {};

  const out: Record<string, { id: string; title: string }> = {};
  for (const title of parsed.data.titles) {
    const match = findSimilarTitles(title, candidates)[0];
    if (match) out[normalizeTitle(title)] = { id: match.id, title: match.title };
  }
  return out;
}

export async function importGranolaNoteToProject(
  projectId: string,
  noteId: string
): Promise<{ success?: boolean; transcript?: ProjectSopTranscript; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders can import from Granola." };

  const parsed = z
    .object({ projectId: z.string().uuid(), noteId: z.string().min(1).max(200) })
    .safeParse({ projectId, noteId });
  if (!parsed.success) return { error: "Invalid input." };

  if (!(await assertTargetOwnership({ kind: "project", projectId: parsed.data.projectId }, profile.id))) {
    return { error: "Not your document." };
  }

  const imported = await getImportedNoteIds(
    { kind: "project", projectId: parsed.data.projectId },
    profile.id,
    [parsed.data.noteId]
  );
  if (imported.size > 0) return { error: "This call is already imported into this project." };

  const accessToken = await getGranolaAccessToken(profile.id);
  if (!accessToken) return { error: "Connect Granola in Settings first." };

  let detail;
  try {
    detail = await getNoteWithTranscript(accessToken, parsed.data.noteId);
  } catch (err) {
    if (err instanceof GranolaAuthError) {
      return { error: "Your Granola connection expired — reconnect it in Settings." };
    }
    if (err instanceof GranolaNotFoundError) {
      return { error: "Granola is still processing this call — try again in a minute." };
    }
    return { error: "Couldn't fetch the call from Granola. Try again in a moment." };
  }

  const transcriptText = transcriptToPlainText(detail.transcript);
  const content = [
    detail.note.summary ? `## Summary\n${detail.note.summary}` : null,
    transcriptText ? `## Transcript\n${transcriptText}` : null,
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, MAX_SOP_CHARS);
  if (!content) return { error: "This call has no summary or transcript yet." };

  const supabase = await getClient(profile.id);
  const { data: transcript, error: insertError } = await supabase
    .from("project_sop_transcripts")
    .insert({
      project_id: parsed.data.projectId,
      uploaded_by: profile.id,
      source_type: "granola",
      label: detail.note.title || "Granola call",
      granola_note_id: parsed.data.noteId,
      content,
      char_count: content.length,
    })
    .select("*")
    .single();
  if (insertError) return { error: insertError.message };

  const { error: ledgerError } = await supabase.from("granola_imports").insert({
    user_id: profile.id,
    granola_note_id: parsed.data.noteId,
    granola_note_title: detail.note.title,
    granola_created_at: detail.note.created_at,
    target_kind: "project",
    project_id: parsed.data.projectId,
    sop_transcript_id: transcript.id,
  });
  if (ledgerError) {
    // Lost a race with a concurrent import — roll back the transcript row so
    // the container doesn't end up with the same call twice.
    await supabase.from("project_sop_transcripts").delete().eq("id", transcript.id);
    if (isUniqueViolation(ledgerError)) {
      return { error: "This call is already imported into this project." };
    }
    return { error: ledgerError.message };
  }

  revalidatePath(`/b/projects/${parsed.data.projectId}`);
  return { success: true, transcript: transcript as ProjectSopTranscript };
}

export interface GranolaTaskDraftsResult {
  noteTitle: string | null;
  noteCreatedAt: string | null;
  drafts: ExtractedTaskDraft[];
  error?: string;
}

/** Fetch a call and AI-draft tasks from it. Creates nothing — the builder
    reviews the drafts and confirms via approveGranolaTasks. Gates, transcript
    fetch, and prompt assembly live in resolveGranolaDraft (lib/granola/
    draft-core.ts), shared with the streaming route. */
export async function draftTasksFromGranolaNote(
  engagementId: string,
  noteId: string
): Promise<GranolaTaskDraftsResult> {
  const empty = { noteTitle: null, noteCreatedAt: null, drafts: [] };
  const timer = stageTimer("granola-draft");

  const resolved = await resolveGranolaDraft(engagementId, noteId, timer);
  if (!resolved.ok) {
    if (resolved.status === 401) redirect("/login");
    return { ...empty, error: resolved.error };
  }

  try {
    const result = await extractTasksFromTranscript(resolved.extractInput, resolved.meta);
    timer.mark("ai");
    timer.done(`noteId=${noteId} drafts=${result.items.length}`);
    return {
      noteTitle: resolved.noteTitle,
      noteCreatedAt: resolved.noteCreatedAt,
      drafts: result.items,
    };
  } catch (err) {
    console.error("[draftTasksFromGranolaNote]", err);
    return { ...empty, error: friendlyAiError(err) };
  }
}

async function runTranscriptTaskExtraction(
  gate: { profileId: string; engagementId: string; builderName: string | null },
  title: string | null,
  transcript: string
): Promise<GranolaTaskDraftsResult> {
  try {
    const result = await extractTasksFromTranscript(
      {
        noteTitle: title,
        summary: null,
        transcript,
        participants: null,
        builderName: gate.builderName,
      },
      {
        userId: gate.profileId,
        operation: "transcript_extract_tasks",
        engagementId: gate.engagementId,
      }
    );
    return { noteTitle: title, noteCreatedAt: null, drafts: result.items };
  } catch (err) {
    console.error("[runTranscriptTaskExtraction]", err);
    return { noteTitle: null, noteCreatedAt: null, drafts: [], error: friendlyAiError(err) };
  }
}

const pasteDraftSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "Paste the transcript text.")
    .max(MAX_SOP_CHARS, "Transcript is too long."),
  label: z.string().trim().max(200).optional(),
});

/** AI-draft tasks from a pasted transcript — the same review/approve flow as
    Granola, just with a manual source. Creates nothing. */
export async function draftTasksFromPastedTranscript(
  engagementId: string,
  content: string,
  label?: string
): Promise<GranolaTaskDraftsResult> {
  const empty = { noteTitle: null, noteCreatedAt: null, drafts: [] };
  const parsed = pasteDraftSchema.safeParse({ content, label: label || undefined });
  if (!parsed.success) {
    return { ...empty, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const gate = await gateTranscriptTaskDrafting(engagementId);
  if (!gate.ok) {
    if (gate.status === 401) redirect("/login");
    return { ...empty, error: gate.error };
  }

  return runTranscriptTaskExtraction(gate, parsed.data.label ?? null, parsed.data.content);
}

/** AI-draft tasks from an uploaded transcript file (same formats as the SOP
    uploader). Creates nothing. */
export async function draftTasksFromTranscriptFile(
  formData: FormData
): Promise<GranolaTaskDraftsResult> {
  const empty = { noteTitle: null, noteCreatedAt: null, drafts: [] };

  const engagementId = formData.get("engagement_id");
  if (typeof engagementId !== "string") return { ...empty, error: "Invalid input." };

  const gate = await gateTranscriptTaskDrafting(engagementId);
  if (!gate.ok) {
    if (gate.status === 401) redirect("/login");
    return { ...empty, error: gate.error };
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return { ...empty, error: "No file provided." };
  if (file.size === 0) return { ...empty, error: "File is empty." };
  if (file.size > MAX_ATTACHMENT_SIZE) return { ...empty, error: "File exceeds 25 MB limit." };

  const extracted = await extractTranscriptText(file);
  if ("error" in extracted) return { ...empty, error: extracted.error };
  const text = extracted.text.slice(0, MAX_SOP_CHARS);

  const label = (file.name.replace(/\.[^.]+$/, "").trim() || file.name).slice(0, 200);
  return runTranscriptTaskExtraction(gate, label, text);
}

// A reviewed draft as approved in the dialog: the AI extraction plus the
// builder-chosen board column ("Lands in"). Done is deliberately excluded —
// creating straight into Done would skip the approval gate.
const ApprovedTaskDraftSchema = ExtractedTaskDraft.extend({
  status: z.enum(["backlog", "todo", "in_progress"]).optional(),
});
export type ApprovedTaskDraft = z.infer<typeof ApprovedTaskDraftSchema>;

/** Dependencies have no dedicated column, so they land in the description —
    kept visible on the task instead of dropped at approval. */
function draftDescription(item: ApprovedTaskDraft): string {
  const deps = (item.dependencies ?? []).map((d) => `- Waiting on ${d.owner}: ${d.requirement}`);
  return deps.length > 0 ? `${item.description}\n\nDependencies:\n${deps.join("\n")}` : item.description;
}

/** One batched tasks insert + one batched audit insert instead of a per-task
    round-trip pair — approving 25 drafts costs 2 DB calls, not ~50. Matches
    createTask's field mapping (lib/actions/tasks.ts); drafts arrive pre-typed,
    so only the deferred hours estimate runs per task, off the response path.
    Checklist entries persist as task_subtasks rows in a third batched insert. */
async function createDraftTasks(
  profileId: string,
  engagementId: string,
  items: ApprovedTaskDraft[]
): Promise<{ created: number; firstError: string | null }> {
  const supabase = await getClient(profileId);
  const { data, error } = await supabase
    .from("tasks")
    .insert(
      items.map((item) => ({
        engagement_id: engagementId,
        title: item.title,
        description: draftDescription(item),
        priority: item.priority,
        type: item.type,
        tags: item.tags,
        // Approval is builder-gated, so the source is always builder_added.
        source: "builder_added",
        created_by: profileId,
        // A bulk insert unifies columns across rows (a missing key becomes an
        // explicit null, NOT the column default), so the default is filled in
        // here — 'backlog' matches the tasks.status DB default (migration 0065).
        status: item.status ?? "backlog",
      }))
    )
    .select("id");
  if (error || !data) return { created: 0, firstError: error?.message ?? null };

  // RETURNING preserves insert order, so rows pair with items by index.
  // Multi-part action items carry their requirements as a checklist — persist
  // each entry as a subtask so nothing lives only in the draft.
  const subtaskRows = data.flatMap((row, i) =>
    (items[i].checklist ?? []).map((title, position) => ({
      task_id: row.id as string,
      created_by: profileId,
      title: title.slice(0, 300),
      position,
    }))
  );
  if (subtaskRows.length > 0) {
    const { error: subtaskError } = await supabase.from("task_subtasks").insert(subtaskRows);
    // Tasks are already created — surface the miss in logs rather than failing
    // the whole approval over checklist rows.
    if (subtaskError) console.error("[createDraftTasks] subtask insert failed:", subtaskError);
  }

  await writeAuditEntries(
    data.map((row, i) => ({
      taskId: row.id as string,
      actorId: profileId,
      action: "task.created",
      metadata: {
        title: items[i].title,
        source: "builder_added",
        priority: items[i].priority,
      },
    }))
  );

  // AI hour estimates self-persist to each task row — defer them past the
  // response like createTask does, so approval returns without N OpenAI calls.
  after(() =>
    Promise.allSettled(
      data.map((row, i) =>
        estimateAndSaveTaskHours({
          taskId: row.id as string,
          title: items[i].title,
          description: items[i].description,
          priority: items[i].priority,
          userId: profileId,
        })
      )
    )
  );

  return { created: data.length, firstError: null };
}

const approveExtractedSchema = z.object({
  engagementId: z.string().uuid(),
  items: z.array(ApprovedTaskDraftSchema).min(1).max(40),
});

/** Create approved drafts from a pasted/uploaded transcript. No Granola note
    backs these, so there's no import-ledger claim — dedupe only applies to
    Granola sources. */
export async function approveExtractedTasks(input: {
  engagementId: string;
  items: ApprovedTaskDraft[];
}): Promise<{ created?: number; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders can draft tasks." };

  const parsed = approveExtractedSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid tasks." };

  if (!(await assertEngagementBuilder(parsed.data.engagementId, profile.id))) {
    return { error: "Not your client." };
  }

  const { created, firstError } = await createDraftTasks(
    profile.id,
    parsed.data.engagementId,
    parsed.data.items
  );
  if (created === 0) {
    return { error: firstError ?? "Couldn't create the tasks. Please try again." };
  }

  revalidatePath(`/b/engagements/${parsed.data.engagementId}`);
  revalidatePath("/b");
  return { created };
}

const approveSchema = z.object({
  engagementId: z.string().uuid(),
  noteId: z.string().min(1).max(200),
  noteTitle: z.string().max(300).nullable(),
  // Coerced to ISO-or-null so the timestamptz insert can never see garbage;
  // it's display metadata, not worth failing the import over.
  noteCreatedAt: z
    .string()
    .max(64)
    .nullable()
    .transform((v) => {
      const t = v ? Date.parse(v) : NaN;
      return Number.isFinite(t) ? new Date(t).toISOString() : null;
    }),
  items: z.array(ApprovedTaskDraftSchema).min(1).max(40),
});

/** Create the approved drafts as backlog tasks and record the import. */
export async function approveGranolaTasks(input: {
  engagementId: string;
  noteId: string;
  noteTitle: string | null;
  noteCreatedAt: string | null;
  items: ApprovedTaskDraft[];
}): Promise<{ created?: number; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders can import from Granola." };

  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid tasks." };

  if (!(await assertEngagementBuilder(parsed.data.engagementId, profile.id))) {
    return { error: "Not your client." };
  }

  const timer = stageTimer("granola-approve");

  // Claim the note in the ledger FIRST — the unique index makes this the
  // atomic gate, so a double-submit can't create the task batch twice.
  const supabase = await getClient(profile.id);
  const { data: ledgerRow, error: ledgerError } = await supabase
    .from("granola_imports")
    .insert({
      user_id: profile.id,
      granola_note_id: parsed.data.noteId,
      granola_note_title: parsed.data.noteTitle,
      granola_created_at: parsed.data.noteCreatedAt,
      target_kind: "engagement",
      engagement_id: parsed.data.engagementId,
      tasks_created: 0,
    })
    .select("id")
    .single();
  timer.mark("ledger");
  if (ledgerError) {
    if (isUniqueViolation(ledgerError)) {
      return { error: "Tasks from this call were already imported for this client." };
    }
    return { error: ledgerError.message };
  }

  let created = 0;
  let firstError: string | null = null;
  try {
    ({ created, firstError } = await createDraftTasks(
      profile.id,
      parsed.data.engagementId,
      parsed.data.items
    ));
  } catch (err) {
    // A throw here would strand the ledger claim — every retry would then hit
    // the unique index with zero tasks to show for it. Release it like the
    // created === 0 branch below.
    console.error("[granola] createDraftTasks threw after ledger claim:", err);
    await supabase.from("granola_imports").delete().eq("id", ledgerRow.id);
    return { error: "Couldn't create the tasks. Please try again." };
  }
  timer.mark("tasks");

  if (created === 0) {
    // Nothing landed — release the claim so the builder can retry.
    await supabase.from("granola_imports").delete().eq("id", ledgerRow.id);
    return { error: firstError ?? "Couldn't create the tasks. Please try again." };
  }

  // Bookkeeping-only update: granola_imports is owner-scoped for select/insert/
  // delete but has no update policy, so under the RLS client this would silently
  // affect 0 rows. Route the count write through the admin client, matching how
  // the audit/usage ledgers record post-hoc metadata (lib/ai/usage.ts).
  await createAdminClient()
    .from("granola_imports")
    .update({ tasks_created: created })
    .eq("id", ledgerRow.id);

  revalidatePath(`/b/engagements/${parsed.data.engagementId}`);
  revalidatePath("/b");
  timer.done(`created=${created}`);
  return { created };
}
