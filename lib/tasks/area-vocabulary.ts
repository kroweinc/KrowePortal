import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import {
  FALLBACK_AREA_VOCABULARY,
  type AreaDefinition,
  type AreaVocabulary,
} from "@/lib/types";
import { deriveRepoAreas, repoAreasInputFrom } from "@/lib/ai/derive-repo-areas";
import { resolveRepoForGeneration } from "@/lib/github/resolve-repo";
import { assertAiBudget } from "@/lib/ai/usage";

// There is deliberately NO staleness TTL here, unlike repo_branches (0070).
// That cache resamples on a timer because its upstream is GitHub's actual branch
// list — deterministic, and a diff means the repo really changed. This cache's
// upstream is a model, which can legitimately return "reports" where it said
// "reporting" an hour earlier. An unattended resample plus the sweep below would
// then delete "reporting" and orphan every task already filed under it: the chip
// would render on the board but appear in no picker and no classifier prompt.
// So re-derivation is explicit — the Refresh button on /b/github — and the warm
// only covers repos that have never been attempted (see repo_area_syncs, 0093).

type AreaRow = { slug: string; label: string; gloss: string };

type SyncOutcome = "ok" | "empty" | "failed";

/** Record that we tried, whatever came of it. This is what stops a repo whose
 *  derivation yields nothing from looking permanently "never attempted" and
 *  re-deriving — an ungated paid model call — on every builder page load. */
async function recordSyncAttempt(
  repoFullName: string,
  outcome: SyncOutcome,
  areaCount: number
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("repo_area_syncs").upsert(
    {
      repo_full_name: repoFullName,
      outcome,
      area_count: areaCount,
      attempted_at: new Date().toISOString(),
    },
    { onConflict: "repo_full_name" }
  );
  if (error) console.error("[recordSyncAttempt]", error.message);
}

/**
 * The repo whose areas apply to this scope, as a full name ("owner/repo").
 * Deliberately a single cheap column read rather than resolveRepoForGeneration:
 * every classification calls this, and resolving a repo costs several queries
 * plus a token decrypt.
 *
 * An engagement resolves ONLY to its own linked repo. It deliberately does not
 * fall through to the builder's personally selected repo: an engagement with no
 * repo yet would otherwise inherit an unrelated product's areas and file a new
 * client's tasks under "checkout" from someone else's storefront. No repo means
 * the generic taxonomy, which is the honest answer. The personal-repo lookup
 * applies only to personal (no-engagement) tasks, which have no other scope.
 */
async function repoFullNameFor(
  profileId: string,
  engagementId: string | null
): Promise<string | null> {
  const supabase = createAdminClient();

  if (engagementId) {
    const { data } = await supabase
      .from("engagements")
      .select("github_repo_full_name")
      .eq("id", engagementId)
      .maybeSingle();
    return (
      (data as { github_repo_full_name: string | null } | null)?.github_repo_full_name ?? null
    );
  }

  const { data: conn } = await supabase
    .from("github_connections")
    .select("selected_repo_full_name")
    .eq("user_id", profileId)
    .maybeSingle();
  return (
    (conn as { selected_repo_full_name: string | null } | null)?.selected_repo_full_name ?? null
  );
}

/** Cached rows → a vocabulary, in derivation order. */
async function readCachedAreas(repoFullName: string): Promise<AreaDefinition[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("repo_areas")
    .select("slug, label, gloss")
    .eq("repo_full_name", repoFullName)
    .order("position", { ascending: true });
  return ((data ?? []) as AreaRow[]).map((r) => ({
    slug: r.slug,
    label: r.label,
    gloss: r.gloss,
  }));
}

/**
 * The label set one classification runs against: the repo's derived areas when
 * it has them, else the generic TASK_TAGS taxonomy.
 *
 * Read-only and cheap — two indexed queries, no GitHub, no AI. It never derives
 * on demand, because deriving costs a model call and this sits inside the path
 * that drafts a task from a call. Warming is a separate, explicit job
 * (warmRepoAreas on /b load, or the Refresh button on /b/github), so the worst
 * case here is a first-ever classification landing on the fallback.
 */
export async function resolveAreaVocabulary(opts: {
  profileId: string;
  engagementId?: string | null;
}): Promise<AreaVocabulary> {
  try {
    const repoFullName = await repoFullNameFor(opts.profileId, opts.engagementId ?? null);
    if (!repoFullName) return FALLBACK_AREA_VOCABULARY;

    const areas = await readCachedAreas(repoFullName);
    if (areas.length === 0) return FALLBACK_AREA_VOCABULARY;

    return { source: "repo", values: areas };
  } catch (err) {
    // A vocabulary lookup must never be the reason a task fails to be created.
    console.error("[resolveAreaVocabulary] falling back", err);
    return FALLBACK_AREA_VOCABULARY;
  }
}

/** Every slug a write may legitimately carry for this scope: the resolved
 *  vocabulary plus the fallback. Both are allowed because a board holds tasks
 *  classified before the repo had areas, and an edit to one of those must not be
 *  rejected for using the label the task already wears. */
export async function allowedAreaSlugs(opts: {
  profileId: string;
  engagementId?: string | null;
}): Promise<Set<string>> {
  const vocab = await resolveAreaVocabulary(opts);
  return new Set([
    ...vocab.values.map((a) => a.slug),
    ...FALLBACK_AREA_VOCABULARY.values.map((a) => a.slug),
  ]);
}

/**
 * The closed-list guarantee on the WRITE paths, restored.
 *
 * Zod can only check a slug's shape (`AREA_SLUG_RE`) — membership depends on the
 * caller's engagement, which a static schema can't see. So every write parses
 * for shape and then runs the result through here, which keeps only slugs the
 * scope actually allows.
 *
 * Drops rather than rejects: a stale vocabulary, or a task wearing a label its
 * repo has since renamed, must never be the reason a create or an approval
 * fails. An unknown slug becomes no chip, which is honest — and it is what stops
 * a hand-rolled POST from persisting the one-off free-form tags (`pdf-forms`,
 * `misc`) the closed list exists to prevent.
 */
export async function sanitizeAreaTags(
  tags: string[] | undefined,
  opts: { profileId: string; engagementId?: string | null }
): Promise<string[]> {
  if (!tags || tags.length === 0) return [];
  const allowed = await allowedAreaSlugs(opts);
  return tags.filter((t) => allowed.has(t)).slice(0, 1);
}

/**
 * Derive a repo's areas and persist them. Records the attempt either way, so a
 * repo that yields nothing is never re-derived by the background warm.
 * Service-role only.
 *
 * A derivation that comes back empty (a repo too thin to name areas for, or one
 * the guard rejected) leaves the existing rows alone rather than sweeping them:
 * an empty result is "I couldn't tell", not "this repo has no areas", and wiping
 * a good vocabulary on one bad sample would silently drop every board chip back
 * to the generic list.
 *
 * The sweep below only runs on an explicit, user-initiated refresh — the caller
 * is the Refresh button. Nothing resamples on a timer, because dropping a slug
 * out from under the tasks already filed there is not something to do unattended
 * (see the note on the missing TTL at the top of this file).
 */
export async function syncRepoAreas(opts: {
  profileId: string;
  engagementId?: string | null;
}): Promise<AreaDefinition[]> {
  const { repoContext } = await resolveRepoForGeneration({
    profileId: opts.profileId,
    engagementId: opts.engagementId ?? undefined,
    logPrefix: "[syncRepoAreas]",
  });
  // No repo resolved, so there is nothing to attempt and nothing to record —
  // the ledger is keyed on a repo name we do not have.
  if (!repoContext) return [];

  let areas: AreaDefinition[];
  try {
    areas = await deriveRepoAreas(repoAreasInputFrom(repoContext), {
      userId: opts.profileId,
      operation: "derive_repo_areas",
      engagementId: opts.engagementId ?? null,
    });
  } catch (err) {
    // Two unparseable samples. Record the attempt so the warm stops retrying it
    // on every page load; the builder can still force one with Refresh.
    console.error("[syncRepoAreas] derivation failed", err);
    await recordSyncAttempt(repoContext.fullName, "failed", 0);
    return [];
  }

  if (areas.length === 0) {
    await recordSyncAttempt(repoContext.fullName, "empty", 0);
    return [];
  }

  const supabase = createAdminClient();
  const now = new Date().toISOString();

  const { error } = await supabase.from("repo_areas").upsert(
    areas.map((a, i) => ({
      repo_full_name: repoContext.fullName,
      slug: a.slug,
      label: a.label,
      gloss: a.gloss,
      position: i,
      synced_at: now,
    })),
    { onConflict: "repo_full_name,slug" }
  );
  if (error) {
    console.error("[syncRepoAreas] upsert failed", error.message);
    await recordSyncAttempt(repoContext.fullName, "failed", 0);
    return [];
  }

  // Sweep areas that fell out of the vocabulary: any row for this repo we didn't
  // just re-stamp keeps its older synced_at. Comparing against `now` avoids
  // embedding slugs in a PostgREST filter. Tasks already tagged with a swept
  // slug keep it — the chip still renders, and re-tagging them is the backfill's
  // job, not a side effect of a refresh.
  await supabase
    .from("repo_areas")
    .delete()
    .eq("repo_full_name", repoContext.fullName)
    .lt("synced_at", now);

  await recordSyncAttempt(repoContext.fullName, "ok", areas.length);
  return areas;
}

/**
 * Background warm for one builder's repos — the areas equivalent of
 * warmEngagementBranches, called from the /b layout.
 *
 * Derives only for repos NEVER ATTEMPTED, judged by repo_area_syncs (0093)
 * rather than by whether repo_areas has rows: a repo whose derivation legitimately
 * produced nothing has no rows either, and using row-presence would re-derive it
 * — a GitHub crawl plus a model call — on every single page load, forever.
 * Nothing re-derives on a timer; that is the Refresh button's job.
 *
 * Caps at one derivation per warm: this runs on every /b load, and a builder with
 * eight cold repos should not pay eight model calls in one page view. The rest
 * warm on subsequent loads. Budget-gated for the same reason — the builder never
 * asked for this work, so it must not be what exhausts their AI budget.
 */
export async function warmRepoAreas(profileId: string): Promise<void> {
  try {
    const supabase = createAdminClient();
    const { data: engagements } = await supabase
      .from("engagements")
      .select("id, github_repo_full_name")
      .eq("builder_id", profileId)
      .not("started_at", "is", null);
    if (!engagements || engagements.length === 0) return;

    // One engagement per repo, so a repo shared across engagements derives once.
    const engagementByRepo = new Map<string, string>();
    for (const e of engagements as { id: string; github_repo_full_name: string | null }[]) {
      if (!e.github_repo_full_name || engagementByRepo.has(e.github_repo_full_name)) continue;
      engagementByRepo.set(e.github_repo_full_name, e.id);
    }
    if (engagementByRepo.size === 0) return;

    const { data: attempted } = await supabase
      .from("repo_area_syncs")
      .select("repo_full_name")
      .in("repo_full_name", Array.from(engagementByRepo.keys()));
    const seen = new Set(
      ((attempted ?? []) as { repo_full_name: string }[]).map((r) => r.repo_full_name)
    );

    const cold = [...engagementByRepo].find(([repoFullName]) => !seen.has(repoFullName));
    if (!cold) return;

    // Checked only once a cold repo is actually found, so the steady state (every
    // repo attempted) stays at the two indexed reads above and never touches the
    // usage ledger.
    const budget = await assertAiBudget(profileId);
    if (!budget.ok) return;

    await syncRepoAreas({ profileId, engagementId: cold[1] });
  } catch (err) {
    // Warming is best-effort: a failure means the next classification uses the
    // fallback vocabulary, which is a working outcome, not an error to surface.
    console.error("[warmRepoAreas]", err);
  }
}
