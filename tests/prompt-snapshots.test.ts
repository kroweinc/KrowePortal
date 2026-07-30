import { expect, test } from "vitest";
import {
  buildClassifyTaskSystemPrompt,
  buildEstimateTaskSystemPrompt,
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
