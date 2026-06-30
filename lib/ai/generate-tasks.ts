import { openai, runChat, AI_MODEL } from "./client";
import type { AiCallMeta } from "./usage";
import { TaskGenerationResult, TaskOnlyResult } from "./schemas";
import { jsonResponseFormat, stripNullsDeep } from "./strict-schema";
import { buildTaskSystemPrompt, buildTaskUserPrompt } from "./prompts";
import type { RepoContext } from "@/lib/github/types";
import { runWithTools, type RepoToolContext } from "@/lib/github/ai-tools";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type OpenAI from "openai";

type ResponseFormat = NonNullable<
  OpenAI.Chat.Completions.ChatCompletionCreateParams["response_format"]
>;

interface GenerateInput {
  rawDescription: string;
  repoContext: RepoContext | null;
  answers?: { questionId: string; answer: string }[];
  toolContext?: RepoToolContext;
}

async function callOpenAIOneShot(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  responseFormat: ResponseFormat,
  meta?: AiCallMeta
): Promise<string> {
  const response = await runChat({
    model: AI_MODEL,
    max_completion_tokens: maxTokens,
    response_format: responseFormat,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  }, meta);
  return response.choices[0]?.message?.content ?? "";
}

async function callOpenAI(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  responseFormat: ResponseFormat,
  toolContext: RepoToolContext | undefined,
  meta?: AiCallMeta
): Promise<string> {
  if (!toolContext) {
    return callOpenAIOneShot(systemPrompt, userPrompt, maxTokens, responseFormat, meta);
  }

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  // The GitHub tool loop only supports json_object (not json_schema), so the
  // repo-aware path keeps the lenient format and relies on safeParse downstream.
  const result = await runWithTools(openai, messages, toolContext, {
    model: AI_MODEL,
    maxTokens,
    responseFormat: { type: "json_object" },
  });

  console.log("[generateTask] tool loop", {
    repo: `${toolContext.owner}/${toolContext.repo}`,
    ...result.telemetry,
  });

  return result.content;
}

export async function generateTask(input: GenerateInput, meta?: AiCallMeta): Promise<TaskGenerationResult> {
  const { rawDescription, repoContext, answers, toolContext } = input;
  const forceTask = (answers?.length ?? 0) > 0;
  const schema = forceTask ? TaskOnlyResult : TaskGenerationResult;
  // Strict json_schema only on the single-object forceTask path with no tools.
  // The question round is a root discriminated union (illegal for strict) and the
  // tool loop can't carry json_schema — both stay json_object.
  const responseFormat: ResponseFormat =
    forceTask && !toolContext
      ? jsonResponseFormat(TaskOnlyResult, "task_draft")
      : { type: "json_object" };
  const systemPrompt = buildTaskSystemPrompt(repoContext, { forceTask });
  const userPrompt = buildTaskUserPrompt(rawDescription, answers);

  const callOnce = () => callOpenAI(systemPrompt, userPrompt, 1500, responseFormat, toolContext, meta);

  // Non-throwing parse: null on a non-JSON or schema-invalid response. safeParse
  // still enforces refinements (estHigh >= estLow, …) and catches a truncated
  // response even when strict mode guarantees the top-level shape.
  const tryParse = (raw: string): TaskGenerationResult | null => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    const result = schema.safeParse(stripNullsDeep(parsed));
    return result.success ? (result.data as TaskGenerationResult) : null;
  };

  // The lenient question round occasionally drifts outside the union on the first
  // sample; resample once before failing (the model reliably self-corrects). The
  // strict forceTask draft is structurally constrained, so it skips the retry.
  let result = tryParse(await callOnce());
  if (!result && !forceTask) result = tryParse(await callOnce());
  if (result) return result;

  // Persistent failure: surface a clear error (the caller degrades). There's no
  // sensible auto-finalize for a question round with no answers to force a task.
  throw new Error("AI response validation failed");
}
