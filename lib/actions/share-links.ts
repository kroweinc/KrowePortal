"use server";

import { createAdminClient } from "@/lib/supabase/server";

const TOKEN_RE = /^[a-f0-9]{64}$/;

// All four shareable tables carry the same token/expiry/revocation columns
// (migration 0062), so one signature covers them.
type ShareTable = "contracts" | "quotes" | "prds" | "builder_profiles";

// Why this exists: the public resolvers (get*ByToken) collapse every failure
// into `null`, so a page can't tell an expired/revoked-but-real link from a
// bogus one. This is a cheap, no-auth second lookup the page runs ONLY on the
// null branch (the error path) to pick a friendlier message — "ask your builder
// for a new link" instead of a generic 404. "unavailable" covers a row that
// exists but is hidden for another reason (draft/rejected/unpublished).
export type ShareLinkState = "expired" | "revoked" | "not-found" | "unavailable";

export async function getShareLinkState(
  table: ShareTable,
  token: string
): Promise<ShareLinkState> {
  if (!TOKEN_RE.test(token)) return "not-found";

  const admin = createAdminClient();
  const { data } = await admin
    .from(table)
    .select("token_expires_at, token_revoked_at")
    .eq("token", token)
    .maybeSingle();

  if (!data) return "not-found";
  if (data.token_revoked_at) return "revoked";
  if (data.token_expires_at && new Date(data.token_expires_at as string) < new Date())
    return "expired";
  return "unavailable";
}
