import { openai, AI_MODEL } from "./client";
import { SimplifyTasksResult } from "./schemas";
import {
  buildSimplifyTasksSystemPrompt,
  buildSimplifyTasksUserPrompt,
  type SimplifyTaskInput,
} from "./prompts";

async function callOpenAI(systemPrompt: string, userPrompt: string): Promise<string> {
  const response = await openai.chat.completions.create({
    model: AI_MODEL,
    max_tokens: 3000,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  return response.choices[0]?.message?.content ?? "";
}

export async function simplifyTasks(input: {
  tasks: SimplifyTaskInput[];
}): Promise<SimplifyTasksResult> {
  if (input.tasks.length === 0) return { items: [] };

  const systemPrompt = buildSimplifyTasksSystemPrompt();
  const userPrompt = buildSimplifyTasksUserPrompt(input.tasks);

  let raw = await callOpenAI(systemPrompt, userPrompt);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AI returned non-JSON response");
  }

  const result = SimplifyTasksResult.safeParse(parsed);
  if (result.success) return result.data;

  const errorDesc = result.error.issues
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("; ");
  raw = await callOpenAI(
    systemPrompt,
    `${userPrompt}\n\nYour previous response did not match the required schema. Errors: ${errorDesc}\nPlease try again.`
  );

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AI returned non-JSON on retry");
  }

  const retryResult = SimplifyTasksResult.safeParse(parsed);
  if (!retryResult.success) {
    throw new Error("AI response validation failed after retry");
  }
  return retryResult.data;
}
