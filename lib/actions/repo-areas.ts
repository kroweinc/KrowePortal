"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { assertAiBudget } from "@/lib/ai/usage";
import { friendlyAiError } from "@/lib/ai/client";
import { writeAuditEntries, type AuditEntryInput } from "@/lib/actions/audit-log";
import {
  BACKFILL_BATCH_SIZE,
  batched,
  classifyTaskAreasBatch,
  type BacklogTask,
} from "@/lib/ai/classify-tasks-bulk";
import { assertEngagementBuilder } from "@/lib/granola/draft-core";
import { resolveAreaVocabulary, syncRepoAreas } from "@/lib/tasks/area-vocabulary";
import type { AreaDefinition } from "@/lib/types";

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : createClient();
}

/**
 * Builder role + ownership of the engagement being acted on.
 *
 * `engagementId` arrives from the client and every export here is a directly
 * invocable POST endpoint, so the role check alone is not a gate: without the
 * membership check a builder could pass someone else's engagement id and read
 * their product areas, re-derive their vocabulary, or bulk re-tag their board.
 * A null engagementId is the builder's own personal scope, which needs no
 * ownership check. Mirrors gateTranscriptTaskDrafting / approveGranolaTasks.
 */
async function gateEngagement(
  engagementId: string | null
): Promise<{ ok: true; profileId: string } | { ok: false; error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { ok: false, error: "Only builders can do that." };
  if (engagementId && !(await assertEngagementBuilder(engagementId, profile.id))) {
    return { ok: false, error: "Not your client." };
  }
  return { ok: true, profileId: profile.id };
}

/**
 * The areas currently cached for an engagement's repo, for the Areas card. An
 * empty list means "not derived yet" — the card says so and offers Derive,
 * rather than silently showing the fallback taxonomy as if it were the repo's.
 */
export async function getRepoAreas(engagementId: string | null): Promise<AreaDefinition[]> {
  const gate = await gateEngagement(engagementId);
  if (!gate.ok) return [];

  const vocab = await resolveAreaVocabulary({ profileId: gate.profileId, engagementId });
  return vocab.source === "repo" ? vocab.values : [];
}

/**
 * Re-derive a repo's areas from scratch, on the builder's say-so. Budget-gated
 * like every other model call, and slow by design (a full repo read plus a
 * generation) — the card shows a pending state rather than pretending it's free.
 *
 * Returns the new vocabulary so the card can paint it without a second read.
 */
export async function refreshRepoAreas(
  engagementId: string | null
): Promise<{ areas: AreaDefinition[] } | { error: string }> {
  const gate = await gateEngagement(engagementId);
  if (!gate.ok) return { error: gate.error };

  const budget = await assertAiBudget(gate.profileId);
  if (!budget.ok) return { error: budget.error };

  try {
    const areas = await syncRepoAreas({ profileId: gate.profileId, engagementId });
    if (areas.length === 0) {
      // Either no repo is linked or the derivation came back too thin to use.
      // Both leave tasks on the generic taxonomy, which is a working state — say
      // that plainly instead of reporting a failure the builder can't act on.
      return {
        error:
          "Couldn't name areas for this repo — its tasks keep the general labels. Try again once the repo has more of the product in it.",
      };
    }
    revalidatePath("/b/github");
    return { areas };
  } catch (err) {
    console.error("[refreshRepoAreas]", err);
    return { error: friendlyAiError(err) };
  }
}

/**
 * Ceiling on one re-tag run. Each BACKFILL_BATCH_SIZE (25) tasks is one serial
 * model call with a reasoning pass, so this bounds the action at ~8 calls —
 * comfortably inside a serverless function's time limit. A bigger board is
 * re-tagged by running it again; the run is idempotent (a task already under
 * the right area produces no write).
 */
const RETAG_MAX_TASKS = 200;

/** Tasks in scope for a re-tag, so the confirm can name a real number before
    the builder spends a model call per 25 of them. */
export async function countTasksForRetag(engagementId: string | null): Promise<number> {
  const gate = await gateEngagement(engagementId);
  if (!gate.ok) return 0;

  const supabase = await getClient(gate.profileId);
  let query = supabase.from("tasks").select("id", { count: "exact", head: true });
  query = engagementId
    ? query.eq("engagement_id", engagementId)
    : query.is("engagement_id", null).eq("created_by", gate.profileId);

  const { count } = await query;
  return count ?? 0;
}

/**
 * Re-file every existing task in one engagement onto the repo's derived areas.
 * The one-time catch-up after a project gets a vocabulary: tasks created before
 * it still wear generic labels, and a board showing "ui" beside "checkout" reads
 * as two systems rather than one.
 *
 * OVERWRITES areas set by hand — including any picked in the Granola review. The
 * confirm copy says so; there is no way to distinguish a hand-set label from a
 * classifier-set one in the tasks table, and asking the model to preserve
 * "unusual" labels would just make it guess.
 *
 * Batched at BACKFILL_BATCH_SIZE, and a failed batch is skipped rather than
 * aborting the run — a partial re-tag is a working board, a half-aborted one
 * with no report is not. Returns how many tasks actually changed.
 */
export async function retagEngagementTasks(
  engagementId: string | null
): Promise<{ retagged: number; considered: number; capped?: boolean } | { error: string }> {
  const gate = await gateEngagement(engagementId);
  if (!gate.ok) return { error: gate.error };
  const profile = { id: gate.profileId };

  const areas = await resolveAreaVocabulary({ profileId: profile.id, engagementId });
  if (areas.source !== "repo") {
    return {
      error: "Find this repo's areas first — there's nothing to re-file tasks onto yet.",
    };
  }

  const budget = await assertAiBudget(profile.id);
  if (!budget.ok) return { error: budget.error };

  const supabase = await getClient(profile.id);
  // Capped, and ordered oldest-first so repeat runs march forward deterministically
  // rather than re-chewing whatever the DB returned first. An uncapped board
  // would fan into unbounded serial model calls and blow the function time
  // limit — and because every write happens after the last batch, a timeout
  // used to mean zero tasks re-filed with every model call still billed.
  let query = supabase
    .from("tasks")
    .select("id, title, description, tags")
    .order("created_at", { ascending: true })
    .limit(RETAG_MAX_TASKS + 1);
  query = engagementId
    ? query.eq("engagement_id", engagementId)
    : query.is("engagement_id", null).eq("created_by", profile.id);

  const { data, error } = await query;
  if (error) return { error: error.message };

  const rows = (data ?? []) as {
    id: string;
    title: string;
    description: string | null;
    tags: string[] | null;
  }[];
  if (rows.length === 0) return { retagged: 0, considered: 0 };

  // One over the cap means there is more to do; trim and tell the caller so the
  // UI can say "run it again" instead of silently under-reporting.
  const capped = rows.length > RETAG_MAX_TASKS;
  const scoped = capped ? rows.slice(0, RETAG_MAX_TASKS) : rows;

  const currentById = new Map(scoped.map((r) => [r.id, (r.tags ?? [])[0] ?? null]));
  const tasks: BacklogTask[] = scoped.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
  }));

  // Commit each batch as it resolves rather than accumulating every assignment
  // and writing at the end: if a later batch fails or the request is cut short,
  // the work already paid for is on the board instead of discarded.
  let retagged = 0;
  for (const batch of batched(tasks, BACKFILL_BATCH_SIZE)) {
    const assigned = await classifyTaskAreasBatch(batch, areas, {
      userId: profile.id,
      operation: "retag_task_areas",
      engagementId,
    });

    // Only write the tasks whose area actually moves. A no-op update would still
    // stamp an audit entry, filling the task's history with "changed ui → ui".
    const changes = [...assigned].filter(([taskId, area]) => currentById.get(taskId) !== area);
    if (changes.length === 0) continue;

    const audits: AuditEntryInput[] = [];
    // Grouped by target area so a 25-task batch costs one UPDATE per distinct
    // area (at most ~12) instead of up to 25 sequential round-trips.
    const byArea = new Map<string, string[]>();
    for (const [taskId, area] of changes) {
      const ids = byArea.get(area);
      if (ids) ids.push(taskId);
      else byArea.set(area, [taskId]);
    }

    for (const [area, taskIds] of byArea) {
      const { error: updateError } = await supabase
        .from("tasks")
        .update({ tags: [area] })
        .in("id", taskIds);
      if (updateError) continue;
      for (const taskId of taskIds) {
        audits.push({
          taskId,
          actorId: profile.id,
          // The repo's field-diff convention, so task-audit-log renders
          // "changed tags from ui to checkout" rather than falling through to
          // its default and dropping the old/new values this bothers to record.
          action: "task.field_changed",
          field: "tags",
          oldValue: currentById.get(taskId),
          newValue: area,
        });
      }
      retagged += taskIds.length;
    }

    await writeAuditEntries(audits);
  }

  revalidatePath("/b");
  revalidatePath("/b/github");
  return { retagged, considered: scoped.length, capped };
}
