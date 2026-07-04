import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { ensureRegisteredClient, refreshTokens } from "@/lib/granola/oauth";

// Tokens are read with the admin client (RLS bypass) because callers have
// already authenticated the profile — never expose a decrypted token beyond
// the server. Mirrors lib/github/token.ts, plus the refresh dance GitHub
// never needs (its tokens don't expire).

const EXPIRY_SKEW_MS = 60_000;

/**
 * Return a valid Granola access token for this profile, refreshing it first
 * when expired or near expiry. Returns null when there is no connection or
 * the refresh fails — callers surface their existing reconnect path.
 *
 * Concurrent refreshes race benignly: last writer wins, and with rotation the
 * loser's next call refreshes again (or falls back to reconnect).
 */
export async function getGranolaAccessToken(profileId: string): Promise<string | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("granola_connections")
    .select("access_token, refresh_token, token_expires_at, oauth_redirect_uri")
    .eq("user_id", profileId)
    .single();
  if (!data?.access_token) return null;

  const expiresAt = data.token_expires_at ? Date.parse(data.token_expires_at) : 0;
  if (Number.isFinite(expiresAt) && expiresAt - Date.now() > EXPIRY_SKEW_MS) {
    return decryptSecret(data.access_token);
  }

  if (!data.refresh_token || !data.oauth_redirect_uri) return null;

  try {
    const client = await ensureRegisteredClient(data.oauth_redirect_uri);
    const tokens = await refreshTokens({
      refreshToken: decryptSecret(data.refresh_token),
      redirectUri: data.oauth_redirect_uri,
      client,
    });
    if ("error" in tokens) {
      console.warn("[granola] token refresh failed:", tokens.error);
      return null;
    }

    await supabase
      .from("granola_connections")
      .update({
        access_token: encryptSecret(tokens.accessToken),
        // Rotation: persist a new refresh token when issued, keep the old
        // one otherwise (some servers only rotate periodically).
        ...(tokens.refreshToken
          ? { refresh_token: encryptSecret(tokens.refreshToken) }
          : {}),
        token_expires_at: new Date(
          Date.now() + (tokens.expiresIn ?? 3600) * 1000
        ).toISOString(),
      })
      .eq("user_id", profileId);

    return tokens.accessToken;
  } catch (err) {
    console.warn("[granola] token refresh threw:", err);
    return null;
  }
}
