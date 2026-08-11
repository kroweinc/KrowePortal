import "server-only";

/**
 * Snapshot a Granola call onto its import ledger row, so /b/meetings/[id] can
 * render it later.
 *
 * Granola exposes no shareable URL — GranolaNote is {id, title, created_at,
 * summary, participants} and no MCP tool produces a link — so "the call this
 * task came from" has to be a page we own, backed by text we captured. Live
 * re-fetching on every view would inherit Granola's rate limits, an OAuth
 * refresh, seconds of latency, and a hard 404 once the note is deleted there.
 *
 * Deliberately a plain server-only helper rather than a "use server" action:
 * it must not be client-callable, and the post-approve after() path and the
 * user-facing retry action have to share one implementation so they can't drift.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { getGranolaAccessToken } from "@/lib/granola/connection";
import { getNoteWithTranscript, transcriptToPlainText } from "@/lib/granola/client";
import { MAX_SOP_CHARS } from "@/lib/attachments-constants";
import type { GranolaTranscriptOutcome } from "@/lib/granola/client";
import type { GranolaTranscriptStatus } from "@/lib/types";

const OUTCOME_TO_STATUS: Record<GranolaTranscriptOutcome, GranolaTranscriptStatus> = {
  ok: "captured",
  // Free workspaces: "Transcripts are only available to paid Granola tiers".
  plan_gated: "plan_gated",
  // Granola hadn't finished processing when we asked.
  not_found: "not_ready",
  empty: "not_ready",
};

/**
 * Fetch the call and write it onto `granola_imports`. Returns the status it
 * recorded, or null if it couldn't even try.
 *
 * Never throws — every caller runs it either from `after()` (where a rejection
 * is invisible) or behind a page render (where it must not take the page down).
 */
export async function captureGranolaMeetingSnapshot(
  importId: string,
  userId: string,
  noteId: string
): Promise<GranolaTranscriptStatus | null> {
  // The ledger row has no UPDATE policy — the same constraint that already
  // routes the tasks_created bookkeeping write through the admin client — and
  // after() runs outside request scope, where a cookie-bound client isn't
  // usable anyway. getGranolaAccessToken reads through the admin client too.
  const admin = createAdminClient();
  const now = new Date().toISOString();

  try {
    const token = await getGranolaAccessToken(userId);
    if (!token) {
      await stamp(admin, importId, { transcript_status: "failed", snapshot_fetched_at: now });
      return "failed";
    }

    const detail = await getNoteWithTranscript(token, noteId);
    const transcript = transcriptToPlainText(detail.transcript).slice(0, MAX_SOP_CHARS);
    const status = OUTCOME_TO_STATUS[detail.transcriptOutcome];

    await stamp(admin, importId, {
      summary: detail.note.summary,
      participants: detail.note.participants,
      transcript: transcript || null,
      transcript_status: status,
      snapshot_fetched_at: now,
    });
    return status;
  } catch (err) {
    console.error("[granola] meeting snapshot failed", { importId, noteId, err });
    // Only the status and the stamp. Patching the text columns here would let a
    // retry against a temporarily-unreachable Granola null out a snapshot that
    // had already succeeded.
    await stamp(admin, importId, { transcript_status: "failed", snapshot_fetched_at: now });
    return "failed";
  }
}

/**
 * `snapshot_fetched_at` is stamped on EVERY attempt, success or failure. That
 * is what makes the meeting page's auto-capture strictly one-shot — it fires
 * only while the stamp is null, so a call that will never capture (deleted in
 * Granola, revoked token) can't re-fetch on every page view.
 */
async function stamp(
  admin: ReturnType<typeof createAdminClient>,
  importId: string,
  patch: Record<string, string | null>
): Promise<void> {
  const { error } = await admin.from("granola_imports").update(patch).eq("id", importId);
  if (error) console.error("[granola] snapshot write failed", { importId, error: error.message });
}
