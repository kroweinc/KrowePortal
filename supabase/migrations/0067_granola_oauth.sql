-- ============================================================
-- Granola: OAuth via the Granola MCP server replaces pasted API keys.
--
-- 1. granola_connections — drop the pasted-key columns and store the
--    OAuth token set instead (AES-256-GCM envelopes via lib/crypto.ts,
--    same as 0066/0006). Existing rows hold keys that are useless under
--    OAuth, so they are cleared before access_token becomes NOT NULL.
--
-- 2. granola_oauth_clients — cache of our Dynamic Client Registration
--    (RFC 7591) against https://mcp-auth.granola.ai, keyed by redirect
--    URI so localhost and production each hold their own client_id.
--    Server-only (service role); RLS enabled with no policies.
--
-- Keep columns in sync with GranolaConnection in lib/types.ts.
-- ============================================================

delete from granola_connections;

alter table granola_connections
  drop column if exists api_key,
  drop column if exists key_last4,
  add column access_token     text not null,  -- iv:tag:ciphertext envelope
  add column refresh_token    text,           -- envelope; null if not granted
  add column token_expires_at timestamptz,    -- null = unknown, treat as expired
  add column granola_email    text,           -- from get_account_info at connect
  -- Redirect URI used at connect time — token refresh (which runs in server
  -- actions with no request origin) looks up the issuing DCR client by it.
  add column oauth_redirect_uri text not null;

create table if not exists granola_oauth_clients (
  redirect_uri  text primary key,
  client_id     text not null,
  client_secret text,  -- envelope; null for public ("none") clients
  registered_at timestamptz not null default now()
);

alter table granola_oauth_clients enable row level security;
-- No policies on purpose: only the server (service role) touches this table.
