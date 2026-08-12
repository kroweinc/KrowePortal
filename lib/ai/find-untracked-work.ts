import { z } from "zod";

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
//
// Reasoning tokens and the visible JSON share this budget. A 13-commit push was
// observed spending the entire 2500 it used to be on reasoning alone and
// returning empty content (finish_reason "length"), which reads downstream as
// "this push shipped nothing". Four proposals cost ~900 output tokens, so this
// leaves the reasoning pass room to be wrong about how much it needs.
const MAX_TOKENS = 4500;

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

  /** One call, parsed. `problem` says what went wrong in enough detail to act
   *  on — a truncated response, a refusal and a schema miss are three different
   *  bugs, and the old log ("did not match the expected shape") named none of
   *  them. A scanned push is never revisited, so a silent miss here is the whole
   *  safeguard failing for that push, permanently. */
  const attempt = async (): Promise<{
    data: z.infer<typeof UntrackedWorkResult> | null;
    problem: string | null;
  }> => {
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

    const choice = response.choices[0];
    const finish = choice?.finish_reason ?? "unknown";
    const text = choice?.message?.content ?? "";
    if (!text) {
      const refusal = choice?.message?.refusal;
      return {
        data: null,
        problem: refusal
          ? `refused: ${refusal.slice(0, 120)}`
          : `empty content (finish_reason=${finish}, reasoning_tokens=${
              response.usage?.completion_tokens_details?.reasoning_tokens ?? "?"
            })`,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        data: null,
        problem: `invalid JSON (finish_reason=${finish}, ${text.length} chars)`,
      };
    }

    const result = UntrackedWorkResult.safeParse(stripNullsDeep(parsed));
    if (result.success) return { data: result.data, problem: null };
    return {
      data: null,
      problem: `schema: ${result.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".") || "(root)"} ${i.code}`)
        .join("; ")}`,
    };
  };

  // Same resample-once contract as matchCommitsToTasks, and the same refusal to
  // throw on a second miss: this is a background safeguard, and no proposals is
  // a fine outcome. Returning [] still lets the caller stamp gaps_scanned_at, so
  // a push that reliably confuses the model isn't re-billed on every board load.
  const first = await attempt();
  const second = first.data ? null : await attempt();
  const result = first.data ?? second?.data ?? null;
  if (!result) {
    console.warn("[findUntrackedWork] no usable response — this push proposes nothing", {
      repo: input.repoFullName,
      commits: input.commits.length,
      first: first.problem,
      second: second?.problem,
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
