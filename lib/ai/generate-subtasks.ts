import { openai, AI_MODEL } from "./client";
import { GenerationResult } from "./schemas";
import { buildSystemPrompt, buildUserPrompt } from "./prompts";
import type { RepoContext } from "@/lib/github/types";
import type { Task, TaskAttachment } from "@/lib/types";

interface GenerateInput {
  task: Pick<Task, "title" | "description">;
  repoContext: RepoContext | null;
  attachments?: Pick<TaskAttachment, "text_content">[];
  answers?: { questionId: string; answer: string }[];
}

async function callOpenAI(systemPrompt: string, userPrompt: string): Promise<string> {
  const response = await openai.chat.completions.create({
    model: AI_MODEL,
    max_tokens: 1024,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  return response.choices[0]?.message?.content ?? "";
}

export async function generateSubtasks(input: GenerateInput): Promise<GenerationResult> {
  const { task, repoContext, attachments = [], answers } = input;
  const systemPrompt = buildSystemPrompt(repoContext);
  const userPrompt = buildUserPrompt(task, attachments, answers);

  let raw = await callOpenAI(systemPrompt, userPrompt);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AI returned non-JSON response");
  }

  const result = GenerationResult.safeParse(parsed);
  if (result.success) return result.data;

  const errorDesc = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  raw = await callOpenAI(
    systemPrompt,
    `${userPrompt}\n\nYour previous response did not match the required schema. Errors: ${errorDesc}\nPlease try again.`
  );

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AI returned non-JSON on retry");
  }

  const retryResult = GenerationResult.safeParse(parsed);
  if (!retryResult.success) {
    throw new Error("AI response validation failed after retry");
  }
  return retryResult.data;
}
