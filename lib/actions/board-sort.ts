"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { TASK_SORT_OPTIONS, type TaskSortKey } from "@/lib/utils";

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : createClient();
}

function isSortKey(value: unknown): value is TaskSortKey {
  return TASK_SORT_OPTIONS.some((o) => o.value === value);
}

/**
 * The signed-in user's saved Build Board sort (migration 0090), or null if they
 * have never picked one — TaskSortProvider then falls back to this browser's
 * localStorage copy.
 *
 * Read here rather than off getCurrentProfile so the dev identities behave like
 * everyone else: those are synthetic objects with no profiles read behind them,
 * so a column added to Profile would always come back undefined for them.
 */
export async function getBoardSort(): Promise<TaskSortKey | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const supabase = await getClient(profile.id);
  const { data } = await supabase
    .from("profiles")
    .select("board_sort")
    .eq("id", profile.id)
    .maybeSingle();

  return isSortKey(data?.board_sort) ? data.board_sort : null;
}

/**
 * Save the board sort on the user's account. Called fire-and-forget: the board
 * has already repainted in the new order by the time this runs, so there is
 * nothing to revalidate — a revalidatePath here would cost a full server
 * round-trip on every dropdown change to re-render a board the client already
 * has right. A failed write simply leaves the localStorage copy in charge for
 * this browser until the next change.
 */
export async function setBoardSort(value: TaskSortKey): Promise<void> {
  const profile = await getCurrentProfile();
  if (!profile || !isSortKey(value)) return;

  const supabase = await getClient(profile.id);
  await supabase.from("profiles").update({ board_sort: value }).eq("id", profile.id);
}
