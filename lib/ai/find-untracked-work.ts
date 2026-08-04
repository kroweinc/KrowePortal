import { runChat, AI_MODEL } from "./client";
import type { AiCallMeta } from "./usage";
import { UntrackedWorkResult } from "./schemas";
import { jsonResponseFormat, stripNullsDeep } from "./strict-schema";
import {
  buildUntrackedWorkSystemPrompt,
  buildUntrackedWorkUserPrompt,
  type UntrackedWorkInput,
} from "./prompts";
import {
  filterUntrackedItems,
  type UntrackedWorkCandidate,
} from "@/lib/tasks/untracked-filter";
import type { TitleCandidate } from "@/lib/tasks/dedupe";

export type { UntrackedWorkCandidate, UntrackedWorkInput };

// One push, one call. A push is already the natural batch — the whole question
// is "what did THIS push carry that no task covers", and splitting it would ask
// the model to judge a deliverable from half its commits.
const MAX_TOKENS = 2500;

/**
 * Ask which deliverables in this push have no task behind them.
 *
 * Returns only whitelist-checked, deduped proposals — usually none, which is
 * the correct answer for a routine push.
 *
 * `existingTitles` is every task title in the engagement, not just the open
 * ones: a push is scanned precisely because its work is done, so the task this
 * would duplicate is almost always a done one.
 */
export async function findUntrackedWork(
  input: UntrackedWorkInput,
  existingTitles: TitleCandidate[],
  meta?: AiCallMeta
): Promise<{ items: UntrackedWorkCandidate[]; model: string }> {
  // Nothing to reason from — no commits means the push contents call degraded.
  if (input.commits.length === 0) return { items: [], model: AI_MODEL };

  const request = async (): Promise<string> => {
    const response = await runChat(
      {
        model: AI_MODEL,
        max_completion_tokens: MAX_TOKENS,
        response_format: jsonResponseFormat(UntrackedWorkResult, "untracked_work"),
        // The system prompt is byte-identical across every push, so it forms one
        // static prefix OpenAI can cache. Everything per-push lives in the user
        // message.
        prompt_cache_key: "untracked-work-v1",
        messages: [
          { role: "system", content: buildUntrackedWorkSystemPrompt() },
          { role: "user", content: buildUntrackedWorkUserPrompt(input) },
        ],
      },
      meta
    );
    return response.choices[0]?.message?.content ?? "";
  };

  const tryParse = (rawText: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return null;
    }
    const result = UntrackedWorkResult.safeParse(stripNullsDeep(parsed));
    return result.success ? result.data : null;
  };

  // Same resample-once contract as matchCommitsToTasks, and the same refusal to
  // throw on a second miss: this is a background safeguard, and no proposals is
  // a fine outcome. Returning [] still lets the caller stamp gaps_scanned_at, so
  // a push that reliably confuses the model isn't re-billed on every board load.
  const result = tryParse(await request()) ?? tryParse(await request());
  if (!result) {
    console.warn("[findUntrackedWork] response did not match the expected shape", {
      repo: input.repoFullName,
      commits: input.commits.length,
    });
    return { items: [], model: AI_MODEL };
  }

  const items = filterUntrackedItems(
    result.items as UntrackedWorkCandidate[],
    { commits: input.commits },
    existingTitles
  );
  return { items, model: AI_MODEL };
}
