import { openai, AI_MODEL } from "./client";
import { GenerationResult, SubtasksOnlyResult } from "./schemas";
import { buildSystemPrompt, buildUserPrompt } from "./prompts";
import type { RepoContext } from "@/lib/github/types";
import type { Task, TaskAttachment } from "@/lib/types";
import { runWithTools, type RepoToolContext } from "@/lib/github/ai-tools";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

interface GenerateInput {
  task: Pick<Task, "title" | "description">;
  repoContext: RepoContext | null;
  attachments?: Pick<TaskAttachment, "text_content">[];
  answers?: { questionId: string; answer: string }[];
  toolContext?: RepoToolContext;
}

async function callOpenAIOneShot(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number
): Promise<string> {
  const response = await openai.chat.completions.create({
    model: AI_MODEL,
    max_completion_tokens: maxTokens,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  return response.choices[0]?.message?.content ?? "";
}

async function callOpenAI(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  toolContext: RepoToolContext | undefined
): Promise<string> {
  if (!toolContext) {
    return callOpenAIOneShot(systemPrompt, userPrompt, maxTokens);
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

  console.log("[generateSubtasks] tool loop", {
    repo: `${toolContext.owner}/${toolContext.repo}`,
    ...result.telemetry,
  });

  return result.content;
}

export async function generateSubtasks(input: GenerateInput): Promise<GenerationResult> {
  const { task, repoContext, attachments = [], answers, toolContext } = input;
  const forceSubtasks = (answers?.length ?? 0) > 0;
  const schema = forceSubtasks ? SubtasksOnlyResult : GenerationResult;
  const systemPrompt = buildSystemPrompt(repoContext, { forceSubtasks });
  const userPrompt = buildUserPrompt(task, attachments, answers);

  let raw = await callOpenAI(systemPrompt, userPrompt, 1024, toolContext);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AI returned non-JSON response");
  }

  const result = schema.safeParse(parsed);
  if (result.success) return result.data as GenerationResult;

  const errorDesc = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  raw = await callOpenAIOneShot(
    systemPrompt,
    `${userPrompt}\n\nYour previous response did not match the required schema. Errors: ${errorDesc}\nPlease try again.`,
    1024
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
  return retryResult.data as GenerationResult;
}
