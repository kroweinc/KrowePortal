import { runChat, AI_MODEL } from "./client";
import type { AiCallMeta } from "./usage";
import { TaskEstimateResult } from "./schemas";
import { jsonResponseFormat, stripNullsDeep } from "./strict-schema";
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

  const callOnce = async (): Promise<string> => {
    const response = await runChat({
      model: AI_MODEL,
      max_completion_tokens: 800,
      response_format: jsonResponseFormat(TaskEstimateResult, "task_estimate"),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }, meta);
    return response.choices[0]?.message?.content ?? "";
  };

  // Defensive parse: content can be "" or truncated at the 800-token cap, which
  // would make a bare JSON.parse throw a raw SyntaxError, and a malformed object
  // would fail safeParse. Return null so we can resample once.
  const tryParse = (raw: string): TaskEstimateResult | null => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    const result = TaskEstimateResult.safeParse(stripNullsDeep(parsed));
    return result.success ? result.data : null;
  };

  // A truncated or malformed estimate self-corrects on a resample; retry once
  // before surfacing a clear error (the caller, estimateAndSaveTaskHours, catches
  // and degrades to "no estimate saved").
  const result = tryParse(await callOnce()) ?? tryParse(await callOnce());
  if (!result) {
    throw new Error("Task estimate response did not match the expected shape.");
  }
  return result;
}
