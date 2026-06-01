import { z } from "zod";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { openai, AI_MODEL } from "./client";
import {
  buildBuildPromptSystemPrompt,
  buildBuildPromptUserPrompt,
  type AgentVariant,
} from "./build-prompt-templates";
import { runWithTools, type RepoToolContext } from "@/lib/github/ai-tools";
import type { RepoContext } from "@/lib/github/types";
import type { Task, Subtask, TaskAttachment } from "@/lib/types";

export type { AgentVariant } from "./build-prompt-templates";

const BuildPromptSchema = z.object({
  prompt: z.string().min(50).max(20000),
  filesReferenced: z.array(z.string().min(1).max(400)).max(40).default([]),
  notes: z.string().max(400).default(""),
});

export type BuildPromptResult = z.infer<typeof BuildPromptSchema>;

export interface GenerateBuildPromptInput {
  task: Pick<Task, "title" | "description" | "priority">;
  subtasks: Pick<Subtask, "title">[];
  attachments: Pick<TaskAttachment, "text_content" | "file_name" | "attachment_type" | "url">[];
  repoContext: RepoContext;
  toolContext: RepoToolContext;
  variant: AgentVariant;
}

export async function generateBuildPrompt(
  input: GenerateBuildPromptInput
): Promise<BuildPromptResult> {
  const { task, subtasks, attachments, repoContext, toolContext, variant } = input;

  const systemPrompt = buildBuildPromptSystemPrompt(repoContext, variant);
  const userPrompt = buildBuildPromptUserPrompt(task, subtasks, attachments);

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const result = await runWithTools(openai, messages, toolContext, {
    model: AI_MODEL,
    maxTokens: 2500,
    responseFormat: { type: "json_object" },
  });

  console.log("[generateBuildPrompt] tool loop", {
    repo: `${toolContext.owner}/${toolContext.repo}`,
    variant,
    ...result.telemetry,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.content);
  } catch {
    throw new Error("AI returned non-JSON response");
  }

  const safe = BuildPromptSchema.safeParse(parsed);
  if (safe.success) return safe.data;

  const errorDesc = safe.error.issues
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("; ");

  const retryMessages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
    { role: "assistant", content: result.content },
    {
      role: "user",
      content: `Your previous response did not match the required schema. Errors: ${errorDesc}\nRespond again with valid JSON only — no tools.`,
    },
  ];

  const retry = await openai.chat.completions.create({
    model: AI_MODEL,
    max_completion_tokens: 2500,
    response_format: { type: "json_object" },
    messages: retryMessages,
  });

  const retryContent = retry.choices[0]?.message?.content ?? "";
  let retryParsed: unknown;
  try {
    retryParsed = JSON.parse(retryContent);
  } catch {
    throw new Error("AI returned non-JSON on retry");
  }

  const retrySafe = BuildPromptSchema.safeParse(retryParsed);
  if (!retrySafe.success) {
    throw new Error("AI response validation failed after retry");
  }
  return retrySafe.data;
}
