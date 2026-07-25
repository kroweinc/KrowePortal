import { expect, test } from "vitest";
import {
  buildClassifyTaskSystemPrompt,
  buildEstimateTaskSystemPrompt,
  buildExtractTasksSystemPrompt,
} from "@/lib/ai/prompts";

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
