import { expect, test } from "vitest";
import {
  buildClassifyTaskSystemPrompt,
  buildEstimateTaskSystemPrompt,
  buildExtractTasksSystemPrompt,
} from "@/lib/ai/prompts";
import {
  buildRefineSectionSystemPrompt,
  buildRefineQuoteSectionSystemPrompt,
} from "@/lib/ai/refine-prompts";
import { buildPrdPrompts } from "@/lib/ai/prd-prompts";

// Snapshots of the rendered system prompts. These make every prompt edit show up
// as a legible diff in review, and fail loudly when a prompt changes as a side
// effect of something else — e.g. adding a value to TASK_TAGS rewrites the
// classify prompt's label list. Free: no API call, no tokens.
// Update deliberately with `npx vitest -u` once the diff is what you intended.

test("classify task system prompt is unchanged", async () => {
  await expect(buildClassifyTaskSystemPrompt()).toMatchFileSnapshot(
    "./__snapshots__/classify-task-system.md"
  );
});

test("estimate task system prompt is unchanged", async () => {
  await expect(buildEstimateTaskSystemPrompt()).toMatchFileSnapshot(
    "./__snapshots__/estimate-task-system.md"
  );
});

// Both identity branches, because the builder-identity line is the ONLY per-call
// text in this prompt — everything above it must stay a byte-identical static
// prefix for prompt_cache_key to be worth anything. A diff that shows per-builder
// text moving ABOVE that last line is the regression to catch.
test("extract tasks system prompt is unchanged", async () => {
  await expect(buildExtractTasksSystemPrompt("Steven Ortega")).toMatchFileSnapshot(
    "./__snapshots__/extract-tasks-system.md"
  );
});

test("extract tasks system prompt is unchanged without a builder name", async () => {
  await expect(buildExtractTasksSystemPrompt(null)).toMatchFileSnapshot(
    "./__snapshots__/extract-tasks-system-no-builder.md"
  );
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
