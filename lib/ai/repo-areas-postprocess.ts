import type { AreaDefinition } from "@/lib/types";

/**
 * The deterministic safety net over one area derivation — the same posture and
 * the same reason as lib/ai/extract-tasks-postprocess.ts: repair what can be
 * repaired, drop what can't, and let the caller see an empty list rather than a
 * bad vocabulary.
 *
 * Pure functions — no "server-only", no env, no network — so the net is
 * unit-testable without a live model (see tests/repo-areas-normalize.test.ts).
 * Everything here is stated in the prompt too; this is what happens when the
 * model doesn't comply, which is the only case that matters. A bad vocabulary
 * is permanent until someone refreshes, and every task classified in the
 * meantime wears a label from it.
 */

/** The upper bound the prompt asks for. Enforced here too — strict mode strips
 *  maxItems from the wire schema, so the cap is prompt text plus this slice. */
const AREAS_MAX = 12;

/** Below this a vocabulary is worse than the generic fallback: two or three
 *  labels can't separate a real backlog, and every task would pile onto one
 *  chip. Treated as a failed derivation, which sends callers to TASK_TAGS. */
const AREAS_MIN_USABLE = 3;

/** Slug ceiling. Matches the prompt's "at most 24 characters" — a longer slug is
 *  truncated rather than dropped, because the label carries the readable form. */
const SLUG_MAX = 24;

/** How close to the cap a hyphen has to be for the truncation to prefer it.
 *  Past this the whole last word would be thrown away to save a few characters. */
const HYPHEN_REACH = 8;

/**
 * Slugs that describe how a codebase is ORGANIZED rather than what it does.
 * Every project of a given stack has these, so a task can be filed under any of
 * them with equal justification — which is the definition of a label that
 * classifies nothing. The prompt forbids them; this is the enforcement, because
 * a forbidden-token rule is exactly the kind the model leaks on (a repo whose
 * top level really is app/lib/components pulls hard toward returning them).
 *
 * This list mirrors rule 7 of buildRepoAreasSystemPrompt and must not exceed it.
 * Words that merely SOUND structural are deliberately absent: "ui" is the real
 * product area of a design system, "packages" and "modules" of a monorepo,
 * "server" and "backend" of a split codebase. Blocking those silently deletes a
 * correct answer, and if the survivors fall under AREAS_MIN_USABLE the repo is
 * reported as unnameable and keeps the generic taxonomy forever.
 */
export const FRAMEWORK_SLUGS = new Set([
  "app",
  "apps",
  "assets",
  "bin",
  "build",
  "components",
  "config",
  "constants",
  "css",
  "dist",
  "helpers",
  "html",
  "javascript",
  "js",
  "json",
  "lib",
  "libs",
  "public",
  "python",
  "scripts",
  "source",
  "src",
  "static",
  "styles",
  "test",
  "tests",
  "ts",
  "types",
  "typescript",
  "util",
  "utils",
  "vendor",
]);

/** Kebab-case a model-supplied slug: lowercase, non-alphanumerics collapse to a
 *  single hyphen, no leading/trailing hyphen, truncated at SLUG_MAX on a hyphen
 *  boundary where one is near the cut so "customer-support-ticketing" becomes
 *  "customer-support" rather than "customer-support-ticke". */
export function normalizeSlug(raw: string): string {
  const kebab = (raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (kebab.length <= SLUG_MAX) return kebab;
  const cut = kebab.slice(0, SLUG_MAX);
  const lastHyphen = cut.lastIndexOf("-");
  return (lastHyphen >= SLUG_MAX - HYPHEN_REACH ? cut.slice(0, lastHyphen) : cut).replace(
    /-+$/,
    ""
  );
}

/**
 * Normalize, dedupe, and vet one derivation's areas.
 *
 * Returns [] when fewer than AREAS_MIN_USABLE areas survive, which callers read
 * as "derivation failed, use the fallback".
 */
export function normalizeAreas(
  raw: { slug: string; label: string; gloss: string }[]
): AreaDefinition[] {
  const seen = new Set<string>();
  const areas: AreaDefinition[] = [];

  for (const candidate of raw) {
    const slug = normalizeSlug(candidate.slug ?? "");
    if (!slug || seen.has(slug) || FRAMEWORK_SLUGS.has(slug)) continue;

    const label = candidate.label?.trim() || slug;
    const gloss = candidate.gloss?.trim();
    // A gloss IS the classifier's decision rule — an area without one is a bare
    // word the model has to guess the meaning of, so it's dropped, not defaulted.
    if (!gloss) continue;

    seen.add(slug);
    areas.push({ slug, label: label.slice(0, 40), gloss: gloss.slice(0, 120) });
    if (areas.length >= AREAS_MAX) break;
  }

  return areas.length >= AREAS_MIN_USABLE ? areas : [];
}
