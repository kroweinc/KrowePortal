import { openai, runChat, AI_MODEL } from "./client";
import type { AiCallMeta } from "./usage";
import { RegenerateTaskResult } from "./schemas";
import { jsonResponseFormat, stripNullsDeep } from "./strict-schema";
import {
  buildTaskRegenerateSystemPrompt,
  buildTaskRegenerateUserPrompt,
} from "./prompts";
import type { RepoContext } from "@/lib/github/types";
import { runWithTools, type RepoToolContext } from "@/lib/github/ai-tools";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type OpenAI from "openai";

type ResponseFormat = NonNullable<
  OpenAI.Chat.Completions.ChatCompletionCreateParams["response_format"]
>;

export interface RegenerateTaskInput {
  current: {
    title: string;
    description: string | null;
    priority: string;
    type: string | null;
    tags: string[];
  };
  // Current subtasks, already labeled S1..Sn in position order — the SAME order
  // reconcileSubtaskPlan uses, so the model's refs map back cleanly.
  subtasks: { label: string; title: string; completed: boolean }[];
  changeNote: string;
  repoContext: RepoContext | null;
  toolContext?: RepoToolContext;
}

// The revised task + up to ~30 reconciled subtask titles + a re-authored
// description; a touch more headroom than the 1500 the fresh-draft path uses.
const MAX_TOKENS = 2000;

async function callOnce(
  systemPrompt: string,
  userPrompt: string,
  responseFormat: ResponseFormat,
  toolContext: RepoToolContext | undefined,
  meta?: AiCallMeta
): Promise<string> {
  if (!toolContext) {
    const response = await runChat(
      {
        model: AI_MODEL,
        max_completion_tokens: MAX_TOKENS,
        response_format: responseFormat,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      },
      meta
    );
    return response.choices[0]?.message?.content ?? "";
  }

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
  // The GitHub tool loop only supports json_object (not json_schema), so the
  // repo-aware path keeps the lenient format and relies on safeParse downstream.
  const result = await runWithTools(openai, messages, toolContext, {
    model: AI_MODEL,
    maxTokens: MAX_TOKENS,
    responseFormat: { type: "json_object" },
  });
  console.log("[regenerateTask] tool loop", {
    repo: `${toolContext.owner}/${toolContext.repo}`,
    ...result.telemetry,
  });
  return result.content;
}

/**
 * Revise an existing task (+ its subtasks) from a builder's change note.
 * Mirrors lib/ai/generate-tasks.ts: strict json_schema on the one-shot path,
 * lenient json_object + safeParse + resample-once on the repo tool-loop path.
 */
export async function runTaskRegeneration(
  input: RegenerateTaskInput,
  meta?: AiCallMeta
): Promise<RegenerateTaskResult> {
  const { repoContext, toolContext } = input;
  const responseFormat: ResponseFormat = toolContext
    ? { type: "json_object" }
    : jsonResponseFormat(RegenerateTaskResult, "task_regeneration");
  const systemPrompt = buildTaskRegenerateSystemPrompt(repoContext);
  const userPrompt = buildTaskRegenerateUserPrompt({
    current: input.current,
    subtasks: input.subtasks,
    changeNote: input.changeNote,
  });

  // Non-throwing parse: null on a non-JSON or schema-invalid response. safeParse
  // still catches a truncated response even when strict mode guarantees the
  // top-level shape; stripNullsDeep turns each new subtask's `ref: null` into an
  // absent key so SubtaskPlanItem's `.nullish()` accepts it.
  const tryParse = (raw: string): RegenerateTaskResult | null => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    const result = RegenerateTaskResult.safeParse(stripNullsDeep(parsed));
    return result.success ? result.data : null;
  };

  const call = () => callOnce(systemPrompt, userPrompt, responseFormat, toolContext, meta);

  let result = tryParse(await call());
  if (!result && toolContext) result = tryParse(await call());
  if (result) return result;

  throw new Error("AI response validation failed");
}
