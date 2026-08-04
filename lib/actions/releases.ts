"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { isEngagementMember } from "@/lib/actions/task-access";
import type { Release, Task } from "@/lib/types";

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : createClient();
}

const RELEASE_COLUMNS =
  "id, engagement_id, kind, title, notes, repo_full_name, branch_name, merge_sha, merge_subject, shipped_at, combined_into_id, created_at";

// Spelled out rather than concatenated: supabase-js infers the row type from
// the select string as a literal, and `A + ", created_by"` widens it to `string`.
const RELEASE_COLUMNS_WITH_OWNER =
  "id, engagement_id, kind, title, notes, repo_full_name, branch_name, merge_sha, merge_subject, shipped_at, combined_into_id, created_at, created_by";

/**
 * Releases visible to the current profile for a set of engagements, newest
 * first — engagement releases plus their own personal (no-engagement) ones.
 * Same scoping rule the boards use for tasks.
 *
 * Returns every release, including kind="combined" parents (which own no tasks
 * of their own) and childless tombstones, because the grouping layer needs the
 * full set to assemble the timeline. Filtering empties out is the caller's job.
 */
export async function getReleasesByEngagement(
  engagementIds: string[]
): Promise<Release[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];

  const supabase = await getClient(profile.id);
  const personalFilter = `and(engagement_id.is.null,created_by.eq.${profile.id})`;
  const filter =
    engagementIds.length > 0
      ? `engagement_id.in.(${engagementIds.join(",")}),${personalFilter}`
      : personalFilter;

  const { data } = await supabase
    .from("releases")
    .select(RELEASE_COLUMNS)
    .or(filter)
    .order("shipped_at", { ascending: false });

  return (data ?? []) as Release[];
}

/**
 * Load a release and confirm the current profile may write to it. Engagement
 * releases need membership *and* the builder role; personal ones need
 * ownership. The role check is explicit because dev profiles use the admin
 * client, which bypasses the is_engagement_builder RLS gate.
 */
async function loadWritableRelease(
  releaseId: string,
  profileId: string,
  role: string
): Promise<{ release: Release } | { error: string }> {
  const supabase = await getClient(profileId);
  const { data } = await supabase
    .from("releases")
    .select(RELEASE_COLUMNS_WITH_OWNER)
    .eq("id", releaseId)
    .maybeSingle();
  if (!data) return { error: "Release not found." };

  const release = data as Release & { created_by: string };
  if (release.engagement_id === null) {
    if (release.created_by !== profileId)
      return { error: "You don't have access to this release." };
  } else {
    if (role !== "builder")
      return { error: "Only the builder can change a release." };
    if (!(await isEngagementMember(release.engagement_id, profileId)))
      return { error: "You don't have access to this release." };
  }
  return { release };
}

const combineSchema = z.object({
  releaseIds: z.array(z.string().uuid()).min(2).max(50),
  title: z.string().trim().min(1).max(120),
});

/**
 * Fold two or more releases into one named release ("Security + staging UI").
 *
 * Creates a new kind="combined" parent and stamps each child's
 * combined_into_id. No task ever moves, which is what makes splitRelease an
 * exact restore rather than a reconstruction. Nesting is refused: an already
 * combined release (or a combined parent) can't be combined again, since
 * flattening it would make the original grouping unrecoverable.
 */
export async function combineReleases(
  releaseIds: string[],
  title: string
): Promise<{ releaseId: string } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = combineSchema.safeParse({ releaseIds, title });
  if (!parsed.success)
    return { error: "Pick at least two releases and give them a name (1–120 characters)." };

  const ids = Array.from(new Set(parsed.data.releaseIds));
  if (ids.length < 2) return { error: "Pick at least two different releases." };

  const supabase = await getClient(profile.id);
  const { data } = await supabase
    .from("releases")
    .select(RELEASE_COLUMNS_WITH_OWNER)
    .in("id", ids);

  const rows = (data ?? []) as (Release & { created_by: string })[];
  if (rows.length !== ids.length) return { error: "Release not found." };

  if (rows.some((r) => r.kind === "combined"))
    return { error: "A combined release can't be folded into another one — split it first." };
  if (rows.some((r) => r.combined_into_id !== null))
    return { error: "One of those is already part of a combined release." };

  // A release never spans engagements, so a combined parent can't either.
  const scopes = new Set(rows.map((r) => r.engagement_id ?? "personal"));
  if (scopes.size > 1)
    return { error: "Those releases belong to different clients — combine them per client." };

  const engagementId = rows[0].engagement_id;
  if (engagementId === null) {
    if (rows.some((r) => r.created_by !== profile.id))
      return { error: "You don't have access to those releases." };
  } else {
    if (profile.role !== "builder")
      return { error: "Only the builder can combine releases." };
    if (!(await isEngagementMember(engagementId, profile.id)))
      return { error: "You don't have access to those releases." };
  }

  // The parent sits at the newest child's slot so the timeline order is stable.
  const shippedAt = rows
    .map((r) => r.shipped_at)
    .reduce((a, b) => (a > b ? a : b));

  const { data: parent, error: insertError } = await supabase
    .from("releases")
    .insert({
      engagement_id: engagementId,
      created_by: profile.id,
      kind: "combined",
      title: parsed.data.title,
      shipped_at: shippedAt,
    })
    .select("id")
    .single();
  if (insertError || !parent) return { error: insertError?.message ?? "Couldn't combine those." };

  const { error: linkError } = await supabase
    .from("releases")
    .update({ combined_into_id: parent.id, updated_at: new Date().toISOString() })
    .in("id", ids);
  if (linkError) {
    // Leave no half-built parent behind — it would render as an empty entry.
    await supabase.from("releases").delete().eq("id", parent.id);
    return { error: linkError.message };
  }

  revalidatePath("/b/staging");
  revalidatePath("/o/changelog");
  return { releaseId: parent.id as string };
}

/**
 * Undo a combine: detach the children and delete the parent. Because combining
 * never moved a task, this restores the exact pre-combine state.
 */
export async function splitRelease(
  releaseId: string
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  if (!z.string().uuid().safeParse(releaseId).success)
    return { error: "Invalid release." };

  const access = await loadWritableRelease(releaseId, profile.id, profile.role);
  if ("error" in access) return access;
  if (access.release.kind !== "combined")
    return { error: "That release isn't a combined one." };

  const supabase = await getClient(profile.id);
  const { error: detachError } = await supabase
    .from("releases")
    .update({ combined_into_id: null, updated_at: new Date().toISOString() })
    .eq("combined_into_id", releaseId);
  if (detachError) return { error: detachError.message };

  const { error } = await supabase.from("releases").delete().eq("id", releaseId);
  if (error) return { error: error.message };

  revalidatePath("/b/staging");
  revalidatePath("/o/changelog");
  return { success: true };
}

const renameSchema = z.object({
  releaseId: z.string().uuid(),
  title: z.string().trim().min(1).max(120),
});

/** Give a release a name, replacing the derived branch/date label. */
export async function renameRelease(
  releaseId: string,
  title: string
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = renameSchema.safeParse({ releaseId, title });
  if (!parsed.success) return { error: "Enter a name (1–120 characters)." };

  const access = await loadWritableRelease(releaseId, profile.id, profile.role);
  if ("error" in access) return access;

  const supabase = await getClient(profile.id);
  const { error } = await supabase
    .from("releases")
    .update({ title: parsed.data.title, updated_at: new Date().toISOString() })
    .eq("id", releaseId);
  if (error) return { error: error.message };

  revalidatePath("/b/staging");
  revalidatePath("/o/changelog");
  return { success: true };
}

const notesSchema = z.object({
  releaseId: z.string().uuid(),
  notes: z.string().trim().max(4000).nullish(),
});

/** Set (or clear) the client-facing blurb shown on the changelog. */
export async function setReleaseNotes(
  releaseId: string,
  notes: string | null
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = notesSchema.safeParse({ releaseId, notes });
  if (!parsed.success) return { error: "Notes can be up to 4000 characters." };

  const access = await loadWritableRelease(releaseId, profile.id, profile.role);
  if ("error" in access) return access;

  const supabase = await getClient(profile.id);
  const { error } = await supabase
    .from("releases")
    .update({
      notes: parsed.data.notes?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", releaseId);
  if (error) return { error: error.message };

  revalidatePath("/b/staging");
  revalidatePath("/o/changelog");
  return { success: true };
}

/** One entry on the operator's changelog: a top-level release and everything
 *  that went live in it (its own tasks, plus its children's when combined). */
export interface ChangelogEntry {
  release: Release;
  /** Folded-in releases, newest first. Empty unless kind is "combined". */
  children: Release[];
  tasks: Pick<Task, "id" | "title" | "type" | "completion_note" | "shipped_at">[];
}

/**
 * The client-facing shipping history for one engagement, newest first.
 *
 * Read-only and safe for operators: every task here is already visible to them
 * (0054 removed per-task visibility, so engagement membership is the only
 * gate). Entries that carry no tasks are dropped — an auto release kept as an
 * idempotency tombstone after an undo would otherwise read as a ghost push.
 */
export async function getClientChangelog(
  engagementId: string
): Promise<ChangelogEntry[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];
  if (!(await isEngagementMember(engagementId, profile.id))) return [];

  const supabase = await getClient(profile.id);

  const [{ data: releaseRows }, { data: taskRows }] = await Promise.all([
    supabase
      .from("releases")
      .select(RELEASE_COLUMNS)
      .eq("engagement_id", engagementId)
      .order("shipped_at", { ascending: false }),
    supabase
      .from("tasks")
      .select("id, title, type, completion_note, shipped_at, release_id")
      .eq("engagement_id", engagementId)
      .eq("status", "done")
      .not("release_id", "is", null)
      .order("shipped_at", { ascending: false, nullsFirst: false }),
  ]);

  const releases = (releaseRows ?? []) as Release[];
  const tasksByRelease = new Map<string, ChangelogEntry["tasks"]>();
  for (const t of (taskRows ?? []) as (ChangelogEntry["tasks"][number] & {
    release_id: string;
  })[]) {
    const { release_id, ...task } = t;
    const bucket = tasksByRelease.get(release_id);
    if (bucket) bucket.push(task);
    else tasksByRelease.set(release_id, [task]);
  }

  const childrenByParent = new Map<string, Release[]>();
  for (const r of releases) {
    if (!r.combined_into_id) continue;
    const bucket = childrenByParent.get(r.combined_into_id);
    if (bucket) bucket.push(r);
    else childrenByParent.set(r.combined_into_id, [r]);
  }

  const entries: ChangelogEntry[] = [];
  for (const release of releases) {
    if (release.combined_into_id) continue; // rendered under its parent
    const children = childrenByParent.get(release.id) ?? [];
    const tasks = [
      ...(tasksByRelease.get(release.id) ?? []),
      ...children.flatMap((c) => tasksByRelease.get(c.id) ?? []),
    ];
    if (tasks.length === 0) continue; // tombstone or emptied-by-undo
    entries.push({ release, children, tasks });
  }
  return entries;
}
