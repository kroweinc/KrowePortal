import { runChat, AI_MODEL } from "./client";
import type { AiCallMeta } from "./usage";
import { TaskEstimateResult } from "./schemas";
import {
  buildEstimateTaskSystemPrompt,
  buildEstimateTaskUserPrompt,
} from "./prompts";

interface EstimateInput {
  title: string;
  description: string | null;
  priority: string;
}

export async function estimateTask(input: EstimateInput, meta?: AiCallMeta): Promise<TaskEstimateResult> {
  const systemPrompt = buildEstimateTaskSystemPrompt();
  const userPrompt = buildEstimateTaskUserPrompt(input);

  const response = await runChat({
    model: AI_MODEL,
    max_completion_tokens: 800,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  }, meta);

  // Defensive parse: content can be "" or truncated at the 800-token cap, which
  // would make a bare JSON.parse throw a raw SyntaxError, and a malformed object
  // would throw a ZodError. Surface a clear error instead (the caller,
  // estimateAndSaveTaskHours, catches and degrades to "no estimate saved").
  const raw = response.choices[0]?.message?.content ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Task estimate response was not valid JSON.");
  }
  const result = TaskEstimateResult.safeParse(parsed);
  if (!result.success) {
    throw new Error("Task estimate response did not match the expected shape.");
  }
  return result.data;
}
