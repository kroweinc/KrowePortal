import OpenAI from "openai";
import { recordAiUsage, type AiCallMeta } from "./usage";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is not set");
}

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  // Hang-guard only. The long PRD/quote/contract generations legitimately run
  // 10-30s+ on the reasoning model, so a tight (e.g. 15s) timeout would abort
  // real work — 120s bounds a truly stuck connection without killing them.
  timeout: 120_000,
});

export const AI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.4-mini";

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";
const REASONING_EFFORTS = new Set<string>(["minimal", "low", "medium", "high"]);

/**
 * Reasoning effort applied to the JSON generations. gpt-5.x is a reasoning model
 * whose latency is dominated by an internal reasoning pass; bounding it to "low"
 * is the biggest speed lever for these structured-output calls, with only a
 * modest depth tradeoff. Override with OPENAI_REASONING_EFFORT (minimal | low |
 * medium | high), or set it to "default"/empty to omit the param entirely and
 * let the model decide. Bump to "medium" if PRD depth ever regresses.
 */
export const AI_REASONING_EFFORT: ReasoningEffort | null = (() => {
  const raw = (process.env.OPENAI_REASONING_EFFORT ?? "low").trim().toLowerCase();
  return REASONING_EFFORTS.has(raw) ? (raw as ReasoningEffort) : null;
})();

/**
 * Chat-completion call that records token usage to the ai_usage ledger when a
 * caller identity is provided. Drop-in for openai.chat.completions.create for
 * the non-streaming JSON generations used across lib/ai. Usage logging is
 * best-effort and never affects the returned completion.
 *
 * Applies AI_REASONING_EFFORT unless the caller already set reasoning_effort,
 * so every JSON generator (PRD draft, free-tier fit, section refine) speeds up
 * from one place.
 */
export async function runChat(
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  meta?: AiCallMeta
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const response = await openai.chat.completions.create({
    ...(AI_REASONING_EFFORT && params.reasoning_effort == null
      ? { reasoning_effort: AI_REASONING_EFFORT }
      : {}),
    ...params,
  });
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
