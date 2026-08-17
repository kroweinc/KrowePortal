import { expect, test } from "vitest";
import {
  buildClassifyTaskSystemPrompt,
  buildEstimateTaskSystemPrompt,
  buildExtractTasksSystemPrompt,
  buildUntrackedWorkSystemPrompt,
} from "@/lib/ai/prompts";
import {
  buildRefineSectionSystemPrompt,
  buildRefineQuoteSectionSystemPrompt,
} from "@/lib/ai/refine-prompts";
import { buildPrdPrompts } from "@/lib/ai/prd-prompts";
import { FALLBACK_AREA_VOCABULARY, type AreaVocabulary } from "@/lib/types";

// A stand-in for one repo's derived areas (repo_areas, migration 0092). Fixed
// here rather than read from a repo so the snapshots stay deterministic.
const REPO_AREAS: AreaVocabulary = {
  source: "repo",
  values: [
    { slug: "checkout", label: "Checkout", gloss: "cart, payment, order confirmation" },
    { slug: "reporting", label: "Reporting", gloss: "dashboards, exports, scheduled emails" },
    { slug: "accounts", label: "Accounts", gloss: "sign-up, sign-in, roles, team members" },
  ],
};

// Snapshots of the rendered system prompts. These make every prompt edit show up
// as a legible diff in review, and fail loudly when a prompt changes as a side
// effect of something else — e.g. adding a value to TASK_TAGS rewrites the
// classify prompt's label list. Free: no API call, no tokens.
// Update deliberately with `npx vitest -u` once the diff is what you intended.

test("classify task system prompt is unchanged", async () => {
  await expect(buildClassifyTaskSystemPrompt(FALLBACK_AREA_VOCABULARY)).toMatchFileSnapshot(
    "./__snapshots__/classify-task-system.md"
  );
});

// The same prompt under a repo's own areas. Snapshotted separately because the
// area list and its framing sentence are the whole point of the vocabulary
// change — this is the diff that shows a classifier being told to file work
// under "checkout" rather than "ui".
test("classify task system prompt is unchanged for repo areas", async () => {
  await expect(buildClassifyTaskSystemPrompt(REPO_AREAS)).toMatchFileSnapshot(
    "./__snapshots__/classify-task-system-repo-areas.md"
  );
});

test("estimate task system prompt is unchanged", async () => {
  await expect(buildEstimateTaskSystemPrompt()).toMatchFileSnapshot(
    "./__snapshots__/estimate-task-system.md"
  );
});

// A pure function of the area vocabulary and nothing else, so it is also the
// assertion that it STAYS one: every per-PUSH value belongs in the user prompt,
// or the prefix prompt_cache_key: "untracked-work-v2-*" caches stops being
// static. The key is keyed by vocabulary source for exactly this reason.
test("untracked work system prompt is unchanged", async () => {
  await expect(buildUntrackedWorkSystemPrompt(FALLBACK_AREA_VOCABULARY)).toMatchFileSnapshot(
    "./__snapshots__/untracked-work-system.md"
  );
});

// Both identity branches, because the builder-identity line and the area block
// are the ONLY per-call text in this prompt — everything above them must stay a
// byte-identical static prefix for prompt_cache_key to be worth anything. A diff
// that shows per-builder or per-repo text moving ABOVE those trailing blocks is
// the regression to catch.
test("extract tasks system prompt is unchanged", async () => {
  await expect(
    buildExtractTasksSystemPrompt("Steven Ortega", FALLBACK_AREA_VOCABULARY)
  ).toMatchFileSnapshot("./__snapshots__/extract-tasks-system.md");
});

test("extract tasks system prompt is unchanged without a builder name", async () => {
  await expect(
    buildExtractTasksSystemPrompt(null, FALLBACK_AREA_VOCABULARY)
  ).toMatchFileSnapshot("./__snapshots__/extract-tasks-system-no-builder.md");
});

test("extract tasks system prompt is unchanged for repo areas", async () => {
  await expect(
    buildExtractTasksSystemPrompt("Steven Ortega", REPO_AREAS)
  ).toMatchFileSnapshot("./__snapshots__/extract-tasks-system-repo-areas.md");
});

// The cache-prefix guarantee, asserted directly rather than left to a human
// reading two snapshots side by side: the extraction instructions are re-sent on
// every call under prompt_cache_key "granola-task-extraction-v3", so the part
// before the per-call blocks must be identical no matter whose repo or whose
// name is in play. Splicing a vocabulary into the base would silently drop the
// cache hit to nothing, and nothing else in the suite would notice.
test("extract tasks prompts share a byte-identical cacheable prefix", () => {
  const a = buildExtractTasksSystemPrompt("Steven Ortega", FALLBACK_AREA_VOCABULARY);
  const b = buildExtractTasksSystemPrompt(null, REPO_AREAS);

  // The base is everything before the first appended block. Both prompts append
  // the identity line first, so that marker is the boundary.
  const MARKER = "\n\nBuilder identity:";
  const base = a.slice(0, a.indexOf(MARKER));

  expect(base.length).toBeGreaterThan(2000);
  expect(base).toContain("You extract action items from one client call");
  // Byte-identical across a different builder AND a different vocabulary — this
  // is the assertion the cache key depends on.
  expect(b.slice(0, b.indexOf(MARKER))).toBe(base);
  // …and the base carries none of the per-call text.
  expect(base).not.toContain("Steven Ortega");
  expect(base).not.toContain("checkout");
});

// The refine prompts carry the rules that make a terse one-liner ("add stripe")
// land as an addition rather than a rewrite — the behavior most likely to regress
// silently. These builders take no arguments on purpose: the section being refined
// is dynamic data and rides in the user prompt, so the system message stays a
// byte-identical cacheable prefix. A diff that reintroduces per-call text here is
// the regression to catch.
test("refine PRD section system prompt is unchanged", async () => {
  await expect(buildRefineSectionSystemPrompt()).toMatchFileSnapshot(
    "./__snapshots__/refine-prd-section-system.md"
  );
});

test("refine quote section system prompt is unchanged", async () => {
  await expect(buildRefineQuoteSectionSystemPrompt()).toMatchFileSnapshot(
    "./__snapshots__/refine-quote-section-system.md"
  );
});

// The PRD interview prompt is the one that decides how many questions the builder
// is asked before a PRD exists, so its wording is worth a visible diff. Only the
// question-round branch is snapshotted: the forced-final branch shares the same
// `base` prefix and differs only by its closing paragraph. Every argument here is
// static — `currentDate` rides in the USER prompt, so the system prompt stays a
// byte-identical cacheable prefix (prompt_cache_key "prd-gen-v1"). A diff that
// shows per-round text moving into `base` is the regression to catch.
test("PRD interview system prompt is unchanged", async () => {
  const { systemPrompt } = buildPrdPrompts({
    title: "Referral tracker",
    forceFinal: false,
    currentDate: "2026-01-01",
  });
  await expect(systemPrompt).toMatchFileSnapshot("./__snapshots__/prd-interview-system.md");
});

// The floor round with a staged step — the two blocks appended AFTER `base`, and
// the ones that hold the interview open when the notes are thin. Snapshotted
// separately because they are where a question-economy edit could go wrong: they
// must still force a question round, not license an early PRD.
test("PRD staged floor-round system prompt is unchanged", async () => {
  const { systemPrompt } = buildPrdPrompts({
    title: "Referral tracker",
    forceFinal: false,
    mustAsk: true,
    deepContext: true,
    seeded: true,
    stageIndex: 1,
    currentDate: "2026-01-01",
  });
  await expect(systemPrompt).toMatchFileSnapshot("./__snapshots__/prd-staged-floor-system.md");
});
