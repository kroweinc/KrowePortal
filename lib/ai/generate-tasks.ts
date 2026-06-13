import { openai, runChat, AI_MODEL } from "./client";
import type { AiCallMeta } from "./usage";
import { TaskGenerationResult, TaskOnlyResult } from "./schemas";
import { buildTaskSystemPrompt, buildTaskUserPrompt } from "./prompts";
import type { RepoContext } from "@/lib/github/types";
import { runWithTools, type RepoToolContext } from "@/lib/github/ai-tools";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

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
  meta?: AiCallMeta
): Promise<string> {
  const response = await runChat({
    model: AI_MODEL,
    max_completion_tokens: maxTokens,
    response_format: { type: "json_object" },
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
  toolContext: RepoToolContext | undefined,
  meta?: AiCallMeta
): Promise<string> {
  if (!toolContext) {
    return callOpenAIOneShot(systemPrompt, userPrompt, maxTokens, meta);
  }

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

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
  const systemPrompt = buildTaskSystemPrompt(repoContext, { forceTask });
  const userPrompt = buildTaskUserPrompt(rawDescription, answers);

  let raw = await callOpenAI(systemPrompt, userPrompt, 1500, toolContext, meta);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AI returned non-JSON response");
  }

  const result = schema.safeParse(parsed);
  if (result.success) return result.data as TaskGenerationResult;

  const errorDesc = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  raw = await callOpenAIOneShot(
    systemPrompt,
    `${userPrompt}\n\nYour previous response did not match the required schema. Errors: ${errorDesc}\nPlease try again.`,
    1500,
    meta
  );

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AI returned non-JSON on retry");
  }

  const retryResult = schema.safeParse(parsed);
  if (!retryResult.success) {
    throw new Error("AI response validation failed after retry");
  }
  return retryResult.data as TaskGenerationResult;
}
