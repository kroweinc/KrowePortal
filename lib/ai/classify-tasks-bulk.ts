import "server-only";

import { runChat, AI_MODEL } from "./client";
import type { AiCallMeta } from "./usage";
import { taskAreaBackfillResult } from "./schemas";
import { jsonResponseFormat, stripNullsDeep } from "./strict-schema";
import {
  buildTaskAreaBackfillSystemPrompt,
  buildTaskAreaBackfillUserPrompt,
  type TaskAreaBackfillInput,
} from "./prompts";
import type { AreaVocabulary } from "@/lib/types";

export type BacklogTask = TaskAreaBackfillInput["tasks"][number];

/**
 * Tasks per model call. The whole point of batching is that re-filing a 200-task
 * board should not be 200 round-trips; 25 keeps a batch's input near ~3k tokens
 * (title + 300 chars of description each) so it decodes quickly and one bad
 * batch loses 25 assignments rather than the board.
 */
export const BACKFILL_BATCH_SIZE = 25;

/** 25 × {taskId, area} is ~500 tokens; the rest is the reasoning pass. */
const MAX_TOKENS = 3_000;

/** Split a list into fixed-size batches, preserving order. */
export function batched<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

/**
 * Assign areas to one batch of existing tasks. Returns a Map of taskId → slug
 * holding ONLY the tasks the model could place — an unplaceable task is absent,
 * and the caller leaves its current label alone.
 *
 * Ids are whitelisted against the batch that was sent, so a hallucinated or
 * echoed-back-wrong id can't write to a task that wasn't under consideration.
 * Never throws: a failed batch returns an empty map, because a backfill that
 * dies halfway through a board is worse than one that re-files less than all.
 */
export async function classifyTaskAreasBatch(
  tasks: BacklogTask[],
  areas: AreaVocabulary,
  meta?: AiCallMeta
): Promise<Map<string, string>> {
  const assigned = new Map<string, string>();
  if (tasks.length === 0 || areas.values.length === 0) return assigned;

  const slugs = areas.values.map((a) => a.slug);
  const allowedIds = new Set(tasks.map((t) => t.id));
  const allowedSlugs = new Set(slugs);

  try {
    const response = await runChat(
      {
        model: AI_MODEL,
        max_completion_tokens: MAX_TOKENS,
        response_format: jsonResponseFormat(taskAreaBackfillResult(slugs), "task_area_backfill"),
        // The system prompt is byte-identical across every batch for one repo,
        // so it caches across the whole backfill — the run is many calls with
        // the same large prefix, which is exactly the case a stable key helps.
        prompt_cache_key: `task-area-backfill-${areas.source}`,
        messages: [
          { role: "system", content: buildTaskAreaBackfillSystemPrompt(areas) },
          { role: "user", content: buildTaskAreaBackfillUserPrompt({ tasks }) },
        ],
      },
      meta
    );

    const text = response.choices[0]?.message?.content ?? "";
    if (!text) return assigned;

    const parsed = taskAreaBackfillResult(slugs).safeParse(stripNullsDeep(JSON.parse(text)));
    if (!parsed.success) {
      console.warn("[classifyTaskAreasBatch] batch failed to parse", parsed.error.message);
      return assigned;
    }

    for (const a of (parsed.data as { assignments: { taskId: string; area: string }[] })
      .assignments) {
      if (allowedIds.has(a.taskId) && allowedSlugs.has(a.area)) assigned.set(a.taskId, a.area);
    }
  } catch (err) {
    console.error("[classifyTaskAreasBatch]", err);
  }

  return assigned;
}
