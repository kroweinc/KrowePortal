import "server-only";

/**
 * Granola task-draft core — the gate/fetch logic shared by the blocking
 * `draftTasksFromGranolaNote` server action (lib/actions/granola-import.ts) and
 * the streaming route (app/api/ai/granola/extract-tasks/stream/route.ts). Kept
 * OUT of the "use server" action file so these are plain server-only helpers
 * (not client-callable RPC) and both paths resolve identically — the streamed
 * extraction can never drift from the blocking one.
 */

import { z } from "zod";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS, DEV_TOGGLE_ENABLED } from "@/lib/auth";
import { getGranolaAccessToken } from "@/lib/granola/connection";
import {
  getNoteWithTranscript,
  transcriptToPlainText,
  GranolaAuthError,
  GranolaNotFoundError,
} from "@/lib/granola/client";
import { assertAiBudget } from "@/lib/ai/usage";
import type { ExtractTasksInput } from "@/lib/ai/extract-tasks-from-transcript";
import type { AiCallMeta } from "@/lib/ai/usage";
import type { StageTimer } from "@/lib/granola/timing";

export const granolaTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project"), projectId: z.string().uuid() }),
  z.object({ kind: z.literal("engagement"), engagementId: z.string().uuid() }),
]);

export type GranolaImportTargetInput = z.infer<typeof granolaTargetSchema>;

export async function getClient(profileId: string) {
  // The dev-profile admin escape only exists while the role switcher does —
  // in production the well-known UUIDs must never grant a service-role client.
  return DEV_TOGGLE_ENABLED && DEV_PROFILE_IDS.has(profileId)
    ? createAdminClient()
    : await createClient();
}

export async function assertEngagementBuilder(
  engagementId: string,
  profileId: string
): Promise<boolean> {
  const supabase = await getClient(profileId);
  const { data } = await supabase
    .from("engagements")
    .select("id")
    .eq("id", engagementId)
    .eq("builder_id", profileId)
    .maybeSingle();
  return !!data;
}

/** Note ids already imported into this specific container. */
export async function getImportedNoteIds(
  target: GranolaImportTargetInput,
  profileId: string,
  noteIds: string[]
): Promise<Set<string>> {
  if (noteIds.length === 0) return new Set();
  const supabase = await getClient(profileId);
  let query = supabase
    .from("granola_imports")
    .select("granola_note_id")
    .in("granola_note_id", noteIds);
  query =
    target.kind === "project"
      ? query.eq("project_id", target.projectId)
      : query.eq("engagement_id", target.engagementId);
  const { data } = await query;
  return new Set((data ?? []).map((r) => r.granola_note_id as string));
}

export type GranolaDraftResolution =
  | { ok: false; status: number; error: string }
  | {
      ok: true;
      profileId: string;
      extractInput: ExtractTasksInput;
      meta: AiCallMeta;
      noteTitle: string | null;
      noteCreatedAt: string | null;
    };

const draftInputSchema = z.object({
  engagementId: z.string().uuid(),
  noteId: z.string().min(1).max(200),
});

/**
 * Everything before the AI call for a Granola task draft: auth, validation,
 * ownership, the already-imported dedupe, the token, the AI budget gate, and
 * the transcript fetch. The four gates are independent reads, so they run
 * concurrently — and the Granola fetch (the slowest pre-AI stage) starts as
 * soon as the token resolves rather than after the last gate. The AI call
 * itself still only happens after every gate has passed.
 */
export async function resolveGranolaDraft(
  engagementId: string,
  noteId: string,
  timer?: StageTimer
): Promise<GranolaDraftResolution> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, status: 401, error: "Not signed in." };
  if (profile.role !== "builder") {
    return { ok: false, status: 403, error: "Only builders can import from Granola." };
  }

  const parsed = draftInputSchema.safeParse({ engagementId, noteId });
  if (!parsed.success) return { ok: false, status: 400, error: "Invalid input." };

  const tokenPromise = getGranolaAccessToken(profile.id);
  const detailPromise = tokenPromise.then((token) =>
    token ? getNoteWithTranscript(token, parsed.data.noteId) : null
  );
  // A failed gate returns early below — the in-flight fetch must not surface
  // as an unhandled rejection when that happens.
  detailPromise.catch(() => {});

  const [isOwner, imported, accessToken, budget] = await Promise.all([
    assertEngagementBuilder(parsed.data.engagementId, profile.id),
    getImportedNoteIds(
      { kind: "engagement", engagementId: parsed.data.engagementId },
      profile.id,
      [parsed.data.noteId]
    ),
    tokenPromise,
    assertAiBudget(profile.id),
  ]);
  timer?.mark("gates");

  if (!isOwner) return { ok: false, status: 403, error: "Not your client." };
  if (imported.size > 0) {
    return {
      ok: false,
      status: 409,
      error: "Tasks from this call were already imported for this client.",
    };
  }
  if (!accessToken) return { ok: false, status: 400, error: "Connect Granola in Settings first." };
  if (!budget.ok) return { ok: false, status: 429, error: budget.error };

  let detail: Awaited<typeof detailPromise>;
  try {
    detail = await detailPromise;
  } catch (err) {
    if (err instanceof GranolaAuthError) {
      // 403, not 401 — 401 is reserved for "not signed in" so the blocking
      // action can map it to the login redirect.
      return {
        ok: false,
        status: 403,
        error: "Your Granola connection expired — reconnect it in Settings.",
      };
    }
    if (err instanceof GranolaNotFoundError) {
      return {
        ok: false,
        status: 404,
        error: "Granola is still processing this call — try again in a minute.",
      };
    }
    return {
      ok: false,
      status: 502,
      error: "Couldn't fetch the call from Granola. Try again in a moment.",
    };
  }
  timer?.mark("granola");
  // accessToken was non-null, so the fetch actually ran.
  if (!detail) return { ok: false, status: 400, error: "Connect Granola in Settings first." };

  const transcriptText = transcriptToPlainText(detail.transcript);
  if (!transcriptText && !detail.note.summary) {
    return { ok: false, status: 409, error: "This call has no summary or transcript yet." };
  }

  return {
    ok: true,
    profileId: profile.id,
    extractInput: {
      noteTitle: detail.note.title,
      summary: detail.note.summary,
      transcript: transcriptText,
      participants: detail.note.participants,
      builderName: profile.display_name,
    },
    meta: {
      userId: profile.id,
      operation: "granola_extract_tasks",
      engagementId: parsed.data.engagementId,
    },
    noteTitle: detail.note.title,
    noteCreatedAt: detail.note.created_at,
  };
}

export type TranscriptDraftGate =
  | { ok: false; status: number; error: string }
  | { ok: true; profileId: string; engagementId: string; builderName: string | null };

/** Shared gate for the non-Granola transcript sources (paste / file upload):
    builder role, engagement ownership, and AI budget — ownership and budget
    are independent reads, run concurrently. */
export async function gateTranscriptTaskDrafting(
  engagementId: string
): Promise<TranscriptDraftGate> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, status: 401, error: "Not signed in." };
  if (profile.role !== "builder") {
    return { ok: false, status: 403, error: "Only builders can draft tasks." };
  }

  const parsed = z.string().uuid().safeParse(engagementId);
  if (!parsed.success) return { ok: false, status: 400, error: "Invalid input." };

  const [isOwner, budget] = await Promise.all([
    assertEngagementBuilder(parsed.data, profile.id),
    assertAiBudget(profile.id),
  ]);
  if (!isOwner) return { ok: false, status: 403, error: "Not your client." };
  if (!budget.ok) return { ok: false, status: 429, error: budget.error };

  return {
    ok: true,
    profileId: profile.id,
    engagementId: parsed.data,
    builderName: profile.display_name,
  };
}
