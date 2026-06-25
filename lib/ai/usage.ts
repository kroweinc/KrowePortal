import { createAdminClient } from "@/lib/supabase/server";
import { checkRate } from "@/lib/rate-limit";

export interface AiCallMeta {
  userId?: string | null;
  operation: string;
  engagementId?: string | null;
}

interface UsageTokens {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
}

// 0 / unset = no cap. Rolling 24h window of total_tokens per user.
const DAILY_TOKEN_CAP = Number(process.env.AI_DAILY_TOKEN_CAP ?? 0);

// Per-user burst limit — independent of the daily spend cap. Stops a runaway
// loop or scripted abuse from racking up generations (and token spend) before
// the coarse daily cap notices. Defaults on; tune via AI_BURST_PER_MIN.
const AI_BURST_PER_MIN = Number(process.env.AI_BURST_PER_MIN ?? 10);

/**
 * Append a row to the ai_usage ledger. Fire-and-forget: usage accounting must
 * never break a generation that already succeeded, and inserts go through the
 * admin client (the ledger has no insert policy).
 */
export async function recordAiUsage(
  meta: AiCallMeta,
  model: string,
  usage: UsageTokens | null | undefined
): Promise<void> {
  if (!meta.userId || !usage) return;
  try {
    const admin = createAdminClient();
    await admin.from("ai_usage").insert({
      user_id: meta.userId,
      engagement_id: meta.engagementId ?? null,
      operation: meta.operation,
      model,
      prompt_tokens: usage.prompt_tokens ?? 0,
      completion_tokens: usage.completion_tokens ?? 0,
      total_tokens: usage.total_tokens ?? 0,
    });
  } catch {
    // Non-critical — never surface ledger failures to the caller.
  }
}

/**
 * Per-user AI gate, checked at action entry before expensive generation. Two
 * layers: a short per-minute burst limit (always on) and a coarse daily token
 * budget (only when AI_DAILY_TOKEN_CAP is set). Both fail open so an infra
 * hiccup never blocks legitimate work.
 */
export async function assertAiBudget(
  userId: string | null | undefined
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!userId) return { ok: true };

  // Burst layer — runs regardless of whether a daily cap is configured.
  const burst = await checkRate({
    key: `ai:user:${userId}`,
    limit: AI_BURST_PER_MIN,
    windowSeconds: 60,
  });
  if (!burst.allowed) {
    return {
      ok: false,
      error: "You're generating too quickly. Please wait a moment and try again.",
    };
  }

  if (!DAILY_TOKEN_CAP) return { ok: true };
  try {
    const admin = createAdminClient();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data } = await admin
      .from("ai_usage")
      .select("total_tokens")
      .eq("user_id", userId)
      .gte("created_at", since);

    const used = (data ?? []).reduce(
      (sum, r) => sum + ((r as { total_tokens?: number }).total_tokens ?? 0),
      0
    );
    if (used >= DAILY_TOKEN_CAP) {
      return {
        ok: false,
        error: "You've reached today's AI usage limit. Please try again tomorrow.",
      };
    }
  } catch (err) {
    // Fail open so a ledger hiccup never blocks legitimate work — but warn so the
    // outage (and the fact the cap isn't being enforced) is visible.
    console.warn(
      "[assertAiBudget] usage ledger read failed; allowing request (cap not enforced)",
      err instanceof Error ? err.message : err
    );
  }
  return { ok: true };
}
