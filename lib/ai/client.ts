import OpenAI from "openai";
import { recordAiUsage, type AiCallMeta } from "./usage";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is not set");
}

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const AI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.4-mini";

/**
 * Reasoning effort for the GPT-5-series model. The default `medium` makes the
 * model spend reasoning tokens "thinking" before it answers — fine for writing a
 * full PRD, but wasted latency when all we need back is the next multiple-choice
 * interview question. We dial it down for question rounds and leave it at the
 * model default for the final PRD (where depth matters). Env-tunable so it's an
 * easy A/B if `low` ever makes the interview feel less adaptive.
 */
export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

const QUESTION_REASONING_EFFORT =
  (process.env.PRD_QUESTION_REASONING_EFFORT as ReasoningEffort | undefined) ?? "low";

/**
 * Effort to use for a generation step. `forceFinal` (the full PRD / quote / section)
 * keeps the model default by returning undefined; intermediate question rounds use
 * the lighter, configurable effort.
 */
export function reasoningEffortFor(forceFinal: boolean): ReasoningEffort | undefined {
  return forceFinal ? undefined : QUESTION_REASONING_EFFORT;
}

/**
 * Chat-completion call that records token usage to the ai_usage ledger when a
 * caller identity is provided. Drop-in for openai.chat.completions.create for
 * the non-streaming JSON generations used across lib/ai. Usage logging is
 * best-effort and never affects the returned completion.
 */
export async function runChat(
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  meta?: AiCallMeta
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const response = await openai.chat.completions.create(params);
  if (meta) void recordAiUsage(meta, String(params.model), response.usage);
  return response;
}

/**
 * Translate a raw OpenAI/network error into a clear, builder-facing sentence.
 * The SDK's default messages ("429 You exceeded your current quota…") are
 * technical and easy to miss; surfacing a plain, actionable line tells the
 * builder exactly what's wrong (most commonly: the OpenAI account is out of
 * billing quota, so generation can't run until credits are added).
 */
export function friendlyAiError(err: unknown): string {
  const e = err as { status?: number; code?: string; type?: string; message?: string } | undefined;
  const code = e?.code ?? e?.type ?? "";
  const status = e?.status;

  if (status === 401 || code === "invalid_api_key") {
    return "The OpenAI API key is invalid or missing. Check OPENAI_API_KEY in your environment.";
  }
  if (code === "insufficient_quota" || (status === 429 && /quota/i.test(e?.message ?? ""))) {
    return "AI generation is unavailable: the OpenAI account is out of quota. Add billing/credits at platform.openai.com/account/billing, then try again.";
  }
  if (status === 429) {
    return "The AI service is rate-limited right now. Wait a few seconds and try again.";
  }
  if (status != null && status >= 500) {
    return "The AI service had a temporary error. Please try again in a moment.";
  }
  return e?.message?.trim() || "AI generation failed. Please try again.";
}
