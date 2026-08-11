"use server";

/**
 * Read side of the Granola meeting page (/b/meetings/[id]).
 *
 * The "meeting" is the `granola_imports` ledger row: it is already one row per
 * (note, engagement), it is created first at approval as the atomic dedupe
 * claim, and migration 0088 hung the call snapshot on it. Builder-only —
 * granola_imports_select never matches an operator.
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth";
import { getClient, assertEngagementBuilder } from "@/lib/granola/draft-core";
import { GRANOLA_HISTORY_DAYS, isBeyondGranolaHistory } from "@/lib/granola/format";
import { captureGranolaMeetingSnapshot } from "@/lib/granola/meeting-snapshot";
import type { GranolaTranscriptStatus, TaskPriority, TaskStatus, TaskType } from "@/lib/types";

export interface GranolaMeetingTask {
  id: string;
  title: string;
  status: TaskStatus;
  type: TaskType | null;
  priority: TaskPriority;
  /** The verbatim line the draft came from. Null on backfilled tasks — those
      quotes were discarded before 0088 and are unrecoverable. */
  sourceQuote: string | null;
}

export interface GranolaMeetingDetail {
  id: string;
  engagementId: string;
  engagementTitle: string | null;
  title: string | null;
  /** When the call happened (granola_created_at) — not when it was imported. */
  callAt: string | null;
  importedAt: string;
  participants: string | null;
  summary: string | null;
  transcript: string | null;
  /** null = the snapshot was never attempted (a pre-0088 import). */
  transcriptStatus: GranolaTranscriptStatus | null;
  /** True while the one-shot capture kicked by this read is still running. */
  capturePending: boolean;
  tasks: GranolaMeetingTask[];
}

const idSchema = z.string().uuid();

type LedgerRow = {
  id: string;
  user_id: string;
  engagement_id: string | null;
  target_kind: string;
  granola_note_id: string;
  granola_note_title: string | null;
  granola_created_at: string | null;
  created_at: string;
  summary: string | null;
  transcript: string | null;
  participants: string | null;
  transcript_status: GranolaTranscriptStatus | null;
  snapshot_fetched_at: string | null;
};

export async function getGranolaMeeting(
  importId: string
): Promise<GranolaMeetingDetail | null> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return null;
  if (!idSchema.safeParse(importId).success) return null;

  const supabase = await getClient(profile.id);
  const { data } = await supabase
    .from("granola_imports")
    .select(
      "id, user_id, engagement_id, target_kind, granola_note_id, granola_note_title, granola_created_at, created_at, summary, transcript, participants, transcript_status, snapshot_fetched_at"
    )
    .eq("id", importId)
    .maybeSingle();

  const row = data as LedgerRow | null;
  // A project import has no tasks and no page — its transcript lives in
  // project_sop_transcripts instead.
  if (!row || row.target_kind !== "engagement" || !row.engagement_id) return null;

  // Not redundant with RLS: getClient hands back a SERVICE-ROLE client for the
  // dev fixture profiles, and under the service role RLS doesn't run at all.
  // This is the only gate in dev, and a real one in prod.
  if (!(await assertEngagementBuilder(row.engagement_id, profile.id))) return null;

  const [engagement, tasks] = await Promise.all([
    supabase.from("engagements").select("title").eq("id", row.engagement_id).maybeSingle(),
    supabase
      .from("tasks")
      .select("id, title, status, type, priority, granola_source_quote")
      .eq("granola_import_id", importId)
      // Belt for anything stamped by the 0088 backfill, which predates the
      // scope trigger that now makes a cross-engagement link impossible.
      .eq("engagement_id", row.engagement_id)
      .order("created_at", { ascending: true })
      .order("sort_order", { ascending: true }),
  ]);

  // Backfilled imports have no snapshot, and neither does an approval whose
  // after() didn't land. Kick exactly ONE capture: the write stamps
  // snapshot_fetched_at whatever the outcome, so this can't loop on a call that
  // will never capture.
  //
  // Except past Granola's 30-day window, where the fetch can only 404 (measured
  // — see GRANOLA_HISTORY_DAYS). Skipping it there spends no OAuth refresh and
  // no MCP call on an answer we already know, and leaves the row unstamped so
  // the page keeps saying "aged out" instead of the wrong "couldn't be reached".
  const capturePending =
    !row.snapshot_fetched_at && !isBeyondGranolaHistory(row.granola_created_at);
  if (capturePending) {
    after(() =>
      captureGranolaMeetingSnapshot(row.id, row.user_id, row.granola_note_id)
    );
  }

  return {
    id: row.id,
    engagementId: row.engagement_id,
    engagementTitle: (engagement.data?.title as string | null) ?? null,
    title: row.granola_note_title,
    callAt: row.granola_created_at,
    importedAt: row.created_at,
    participants: row.participants,
    summary: row.summary,
    transcript: row.transcript,
    transcriptStatus: row.transcript_status,
    capturePending,
    tasks: (tasks.data ?? []).map((t) => ({
      id: t.id as string,
      title: t.title as string,
      status: t.status as TaskStatus,
      type: (t.type as TaskType | null) ?? null,
      priority: t.priority as TaskPriority,
      sourceQuote: (t.granola_source_quote as string | null) ?? null,
    })),
  };
}

/** "Try again" on a meeting whose snapshot failed or was never taken. Runs the
    fetch inline — this one is user-initiated, so blocking is the honest UX. */
export async function refreshGranolaMeetingSnapshot(
  importId: string
): Promise<{ status?: GranolaTranscriptStatus; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders can read calls." };
  if (!idSchema.safeParse(importId).success) return { error: "Invalid meeting." };

  const supabase = await getClient(profile.id);
  const { data } = await supabase
    .from("granola_imports")
    .select("id, user_id, engagement_id, target_kind, granola_note_id, granola_created_at")
    .eq("id", importId)
    .maybeSingle();

  const row = data as Pick<
    LedgerRow,
    "id" | "user_id" | "engagement_id" | "target_kind" | "granola_note_id" | "granola_created_at"
  > | null;
  if (!row || row.target_kind !== "engagement" || !row.engagement_id) {
    return { error: "That call isn't available." };
  }
  if (!(await assertEngagementBuilder(row.engagement_id, profile.id))) {
    return { error: "Not your client." };
  }
  // The UI hides the retry past the window; this is the same rule at the door,
  // so a stale page can't spend a Granola round-trip on a certain 404 — and,
  // more importantly, can't stamp `failed` over what the import did save.
  if (isBeyondGranolaHistory(row.granola_created_at)) {
    return { error: `Granola no longer serves calls older than ${GRANOLA_HISTORY_DAYS} days.` };
  }

  const status = await captureGranolaMeetingSnapshot(
    row.id,
    row.user_id,
    row.granola_note_id
  );
  revalidatePath(`/b/meetings/${importId}`);
  return status ? { status } : { error: "Couldn't reach Granola. Try again in a moment." };
}
