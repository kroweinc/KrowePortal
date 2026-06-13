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

  const raw = response.choices[0]?.message?.content ?? "";
  const parsed = JSON.parse(raw);
  return TaskEstimateResult.parse(parsed);
}
