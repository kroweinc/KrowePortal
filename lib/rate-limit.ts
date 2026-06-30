import { createAdminClient } from "@/lib/supabase/server";

export interface RateLimitCheck {
  /** Opaque limiter key, e.g. `sign:ip:1.2.3.4`, `ai:user:<uuid>`. */
  key: string;
  /** Max requests allowed within the window. 0/falsy disables the check. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the current window resets — only set when not allowed. */
  retryAfterSeconds?: number;
}

interface CheckRateRow {
  allowed: boolean;
  current_count: number;
  reset_at: number;
}

/**
 * Fixed-window rate limit gate backed by Postgres (the rate_limits table + the
 * check_rate_limit RPC, migration 0063). FAIL-OPEN, exactly like assertAiBudget:
 * a limiter outage must never lock out legitimate traffic, so any infra error
 * logs a warning and allows the request.
 */
export async function checkRate({
  key,
  limit,
  windowSeconds,
}: RateLimitCheck): Promise<RateLimitResult> {
  // Limit of 0/undefined ⇒ disabled (parity with AI_DAILY_TOKEN_CAP unset).
  if (!limit) return { allowed: true };
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("check_rate_limit", {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) throw error;

    // A set-returning rpc() yields an array of one row.
    const row = (Array.isArray(data) ? data[0] : data) as CheckRateRow | undefined;
    if (!row || row.allowed) return { allowed: true };

    const nowSec = Math.floor(Date.now() / 1000);
    const retryAfterSeconds = Math.max(1, Number(row.reset_at) - nowSec);
    return { allowed: false, retryAfterSeconds };
  } catch (err) {
    console.warn(
      "[checkRate] limiter unavailable; allowing request (limit not enforced)",
      err instanceof Error ? err.message : err
    );
    return { allowed: true };
  }
}
