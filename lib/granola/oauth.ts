import "server-only";

import { createHash, randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

// OAuth 2.1 against Granola's MCP auth server (metadata at
// https://mcp.granola.ai/.well-known/oauth-authorization-server):
// authorization-code + PKCE (S256), refresh_token grant, Dynamic Client
// Registration (RFC 7591). We register as a public client ("none" auth) —
// PKCE is the proof of possession — and cache the registration per redirect
// URI in granola_oauth_clients so localhost and prod each hold their own.
export const GRANOLA_AUTH_BASE = "https://mcp-auth.granola.ai";
export const GRANOLA_MCP_RESOURCE = "https://mcp.granola.ai/mcp";
export const GRANOLA_SCOPES = "openid profile email offline_access";

const CALLBACK_PATH = "/api/granola/callback";
const REQUEST_TIMEOUT_MS = 10_000;

function originFromHost(host: string): string {
  const normalized = host.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${normalized}`;
}

/**
 * Resolve the Granola OAuth redirect URI. Same priority chain as
 * resolveGithubRedirectUri (lib/github/oauth-config.ts):
 * 1. GRANOLA_REDIRECT_URI — explicit override
 * 2. APP_ORIGIN / NEXT_PUBLIC_APP_ORIGIN — public host when proxied
 * 3. Vercel production host
 * 4. Request origin in non-production — local dev on port 3030, etc.
 */
export function resolveGranolaRedirectUri(requestOrigin?: string): string | undefined {
  const explicit = process.env.GRANOLA_REDIRECT_URI?.trim();
  if (explicit) return explicit;

  const appOrigin =
    process.env.APP_ORIGIN?.trim() || process.env.NEXT_PUBLIC_APP_ORIGIN?.trim();
  if (appOrigin) return `${appOrigin.replace(/\/+$/, "")}${CALLBACK_PATH}`;

  if (process.env.VERCEL_ENV === "production") {
    const host =
      process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || process.env.VERCEL_URL?.trim();
    if (host) return `${originFromHost(host)}${CALLBACK_PATH}`;
  }

  if (process.env.NODE_ENV !== "production" && requestOrigin) {
    return `${requestOrigin.replace(/\/+$/, "")}${CALLBACK_PATH}`;
  }

  return undefined;
}

export interface PkcePair {
  verifier: string;
  challenge: string; // S256
}

export function createPkcePair(): PkcePair {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export interface GranolaOAuthClient {
  clientId: string;
  clientSecret: string | null;
}

/**
 * Return our registered OAuth client for this redirect URI, performing
 * Dynamic Client Registration on first use and caching the result.
 */
export async function ensureRegisteredClient(
  redirectUri: string
): Promise<GranolaOAuthClient> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("granola_oauth_clients")
    .select("client_id, client_secret")
    .eq("redirect_uri", redirectUri)
    .maybeSingle();
  if (data?.client_id) {
    return {
      clientId: data.client_id,
      clientSecret: data.client_secret ? decryptSecret(data.client_secret) : null,
    };
  }

  const res = await fetch(`${GRANOLA_AUTH_BASE}/oauth2/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      client_name: "Krowe Portal",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: GRANOLA_SCOPES,
    }),
  });
  if (!res.ok) {
    throw new Error(`Granola client registration failed (${res.status})`);
  }
  const registration = (await res.json()) as {
    client_id?: string;
    client_secret?: string;
  };
  if (!registration.client_id) {
    throw new Error("Granola client registration returned no client_id");
  }

  // Upsert so a concurrent first-connect race just overwrites with an equally
  // valid registration instead of failing on the primary key.
  await supabase.from("granola_oauth_clients").upsert(
    {
      redirect_uri: redirectUri,
      client_id: registration.client_id,
      client_secret: registration.client_secret
        ? encryptSecret(registration.client_secret)
        : null,
      registered_at: new Date().toISOString(),
    },
    { onConflict: "redirect_uri" }
  );

  return {
    clientId: registration.client_id,
    clientSecret: registration.client_secret ?? null,
  };
}

async function forgetRegisteredClient(redirectUri: string): Promise<void> {
  await createAdminClient().from("granola_oauth_clients").delete().eq("redirect_uri", redirectUri);
}

export interface GranolaTokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null; // seconds
}

async function tokenRequest(
  params: Record<string, string>,
  client: GranolaOAuthClient
): Promise<GranolaTokenSet | { error: string }> {
  const body = new URLSearchParams({
    ...params,
    client_id: client.clientId,
    resource: GRANOLA_MCP_RESOURCE,
  });
  if (client.clientSecret) body.set("client_secret", client.clientSecret);

  const res = await fetch(`${GRANOLA_AUTH_BASE}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body,
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof data.access_token !== "string") {
    return { error: typeof data.error === "string" ? data.error : `http_${res.status}` };
  }
  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
    expiresIn: typeof data.expires_in === "number" ? data.expires_in : null,
  };
}

/**
 * Run a token-endpoint request, recovering once from invalid_client by
 * re-registering (a cached DCR registration can be dropped server-side).
 */
async function tokenRequestWithRecovery(
  params: Record<string, string>,
  redirectUri: string,
  client: GranolaOAuthClient
): Promise<GranolaTokenSet | { error: string }> {
  const first = await tokenRequest(params, client);
  if (!("error" in first) || first.error !== "invalid_client") return first;

  await forgetRegisteredClient(redirectUri);
  const freshClient = await ensureRegisteredClient(redirectUri);
  return tokenRequest(params, freshClient);
}

export async function exchangeCode(input: {
  code: string;
  redirectUri: string;
  verifier: string;
  client: GranolaOAuthClient;
}): Promise<GranolaTokenSet | { error: string }> {
  return tokenRequestWithRecovery(
    {
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.verifier,
    },
    input.redirectUri,
    input.client
  );
}

export async function refreshTokens(input: {
  refreshToken: string;
  redirectUri: string;
  client: GranolaOAuthClient;
}): Promise<GranolaTokenSet | { error: string }> {
  return tokenRequestWithRecovery(
    { grant_type: "refresh_token", refresh_token: input.refreshToken },
    input.redirectUri,
    input.client
  );
}
