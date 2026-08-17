import { runChat, AI_MODEL } from "./client";
import type { AiCallMeta } from "./usage";
import { taskClassifyResult, type TaskClassifyResult } from "./schemas";
import { jsonResponseFormat, stripNullsDeep } from "./strict-schema";
import {
  buildClassifyTaskSystemPrompt,
  buildClassifyTaskUserPrompt,
} from "./prompts";
import { FALLBACK_AREA_VOCABULARY, type AreaVocabulary } from "@/lib/types";

interface ClassifyInput {
  title: string;
  description: string | null;
  /** The label set to classify against — the engagement's repo areas, or the
      generic fallback. Defaults to the fallback so a caller with no engagement
      scope still classifies. */
  areas?: AreaVocabulary;
}

export async function classifyTask(input: ClassifyInput, meta?: AiCallMeta): Promise<TaskClassifyResult> {
  const areas = input.areas ?? FALLBACK_AREA_VOCABULARY;
  const schema = taskClassifyResult(areas.values.map((a) => a.slug));
  const systemPrompt = buildClassifyTaskSystemPrompt(areas);
  const userPrompt = buildClassifyTaskUserPrompt(input);

  const callOnce = async (): Promise<string> => {
    const response = await runChat({
      model: AI_MODEL,
      max_completion_tokens: 400,
      response_format: jsonResponseFormat(schema, "task_classification"),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }, meta);
    return response.choices[0]?.message?.content ?? "";
  };

  // Defensive parse: content can be "" or truncated, which would make a bare
  // JSON.parse throw, and a malformed object would fail safeParse. Return null
  // so we can resample once.
  const tryParse = (raw: string): TaskClassifyResult | null => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    const result = schema.safeParse(stripNullsDeep(parsed));
    return result.success ? (result.data as TaskClassifyResult) : null;
  };

  // A truncated or malformed classification self-corrects on a resample; retry
  // once before surfacing a clear error (the caller, classifyAndSaveTask, catches
  // and degrades to "no type saved").
  const result = tryParse(await callOnce()) ?? tryParse(await callOnce());
  if (!result) {
    throw new Error("Task classification response did not match the expected shape.");
  }
  return result;
}
