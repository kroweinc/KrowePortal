import { openai, runChat, AI_MODEL } from "./client";
import type { AiCallMeta } from "./usage";
import { SubtasksResult } from "./schemas";
import { jsonResponseFormat, stripNullsDeep } from "./strict-schema";
import { buildSubtasksSystemPrompt, buildSubtasksUserPrompt } from "./prompts";
import type { RepoContext } from "@/lib/github/types";
import { runWithTools, type RepoToolContext } from "@/lib/github/ai-tools";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type OpenAI from "openai";

type ResponseFormat = NonNullable<
  OpenAI.Chat.Completions.ChatCompletionCreateParams["response_format"]
>;

interface GenerateInput {
  task: { title: string; description: string | null };
  repoContext: RepoContext | null;
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

  console.log("[generateSubtasks] tool loop", {
    repo: `${toolContext.owner}/${toolContext.repo}`,
    ...result.telemetry,
  });

  return result.content;
}

export async function generateSubtasks(
  input: GenerateInput,
  meta?: AiCallMeta
): Promise<SubtasksResult> {
  const { task, repoContext, toolContext } = input;
  // Strict json_schema only on the one-shot (no-tools) path; the tool loop can't
  // carry json_schema, so it stays json_object and leans on safeParse.
  const responseFormat: ResponseFormat = toolContext
    ? { type: "json_object" }
    : jsonResponseFormat(SubtasksResult, "subtasks");
  const systemPrompt = buildSubtasksSystemPrompt(repoContext);
  const userPrompt = buildSubtasksUserPrompt(task);

  const callOnce = () => callOpenAI(systemPrompt, userPrompt, 1024, responseFormat, toolContext, meta);

  const tryParse = (raw: string): SubtasksResult | null => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    const result = SubtasksResult.safeParse(stripNullsDeep(parsed));
    return result.success ? result.data : null;
  };

  // Resample once before failing — the model reliably self-corrects a stray
  // first sample (extra wrapper key, a too-short title tripping safeParse).
  let result = tryParse(await callOnce());
  if (!result) result = tryParse(await callOnce());
  if (result) return result;

  throw new Error("AI response validation failed");
}
