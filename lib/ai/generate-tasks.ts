import { openai, runChat, AI_MODEL } from "./client";
import type { AiCallMeta } from "./usage";
import { TaskOnlyResult } from "./schemas";
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
  toolContext?: RepoToolContext;
  // Q&A from prior "strengthen" rounds, woven into the user prompt so the
  // regenerated draft reflects the user's answers.
  clarifications?: { question: string; answer: string }[];
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

export async function generateTask(input: GenerateInput, meta?: AiCallMeta): Promise<TaskOnlyResult> {
  const { rawDescription, repoContext, toolContext, clarifications } = input;
  // Strict json_schema on the one-shot path; the tool loop can't carry
  // json_schema, so it stays lenient json_object and relies on safeParse.
  const responseFormat: ResponseFormat = toolContext
    ? { type: "json_object" }
    : jsonResponseFormat(TaskOnlyResult, "task_draft");
  const systemPrompt = buildTaskSystemPrompt(repoContext);
  const userPrompt = buildTaskUserPrompt(rawDescription, clarifications);

  const callOnce = () => callOpenAI(systemPrompt, userPrompt, 1500, responseFormat, toolContext, meta);

  // Non-throwing parse: null on a non-JSON or schema-invalid response. safeParse
  // still enforces refinements and catches a truncated response even when strict
  // mode guarantees the top-level shape.
  const tryParse = (raw: string): TaskOnlyResult | null => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    const result = TaskOnlyResult.safeParse(stripNullsDeep(parsed));
    return result.success ? result.data : null;
  };

  // The lenient tool-loop path occasionally drifts outside the schema on the
  // first sample; resample once before failing (the model reliably
  // self-corrects). The strict one-shot draft is structurally constrained, so
  // it skips the retry.
  let result = tryParse(await callOnce());
  if (!result && toolContext) result = tryParse(await callOnce());
  if (result) return result;

  // Persistent failure: surface a clear error (the caller degrades).
  throw new Error("AI response validation failed");
}
