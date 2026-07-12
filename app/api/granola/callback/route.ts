import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { createAdminClient } from "@/lib/supabase/server"
import { getCurrentProfile } from "@/lib/auth"
import { getPublicAppOrigin } from "@/lib/app-origin"
import { encryptSecret } from "@/lib/crypto"
import {
  ensureRegisteredClient,
  exchangeCode,
  resolveGranolaRedirectUri,
} from "@/lib/granola/oauth"
import { getAccountInfo } from "@/lib/granola/client"
import {
  GRANOLA_OAUTH_STATE_COOKIE,
  GRANOLA_PKCE_VERIFIER_COOKIE,
  GRANOLA_OAUTH_RETURN_COOKIE,
} from "../connect/route"

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const publicOrigin = getPublicAppOrigin(origin)
  const code = searchParams.get("code")
  const state = searchParams.get("state")

  // CSRF: the returned state must match the nonce we set at connect time,
  // and the PKCE verifier must still be present.
  const cookieStore = await cookies()
  const expectedState = cookieStore.get(GRANOLA_OAUTH_STATE_COOKIE)?.value
  const verifier = cookieStore.get(GRANOLA_PKCE_VERIFIER_COOKIE)?.value
  cookieStore.set(GRANOLA_OAUTH_STATE_COOKIE, "", { maxAge: 0, path: "/" })
  cookieStore.set(GRANOLA_PKCE_VERIFIER_COOKIE, "", { maxAge: 0, path: "/" })

  const rawReturnTo = cookieStore.get(GRANOLA_OAUTH_RETURN_COOKIE)?.value
  cookieStore.set(GRANOLA_OAUTH_RETURN_COOKIE, "", { maxAge: 0, path: "/" })
  const returnTo =
    rawReturnTo && rawReturnTo.startsWith("/") && !rawReturnTo.startsWith("//")
      ? rawReturnTo
      : null
  const errorRedirect = (codeName: string) =>
    NextResponse.redirect(`${publicOrigin}${returnTo ?? "/b/settings/granola"}?error=${codeName}`)

  // User cancelled at Granola, or the round-trip lost its cookies.
  if (searchParams.get("error") || !code || !state || !expectedState || state !== expectedState || !verifier) {
    return errorRedirect("granola_denied")
  }

  // Identity is taken from the authenticated session — never from the URL.
  const profile = await getCurrentProfile()
  if (!profile) {
    return NextResponse.redirect(`${publicOrigin}/login`)
  }
  // Mirror the connect route's gate: only builders may hold a connection.
  if (profile.role !== "builder") {
    return errorRedirect("granola_denied")
  }

  const redirectUri = resolveGranolaRedirectUri(publicOrigin)
  if (!redirectUri) {
    console.error("[granola/callback] redirect URI could not be resolved")
    return errorRedirect("granola_token_failed")
  }

  let tokens
  try {
    const client = await ensureRegisteredClient(redirectUri)
    tokens = await exchangeCode({ code, redirectUri, verifier, client })
  } catch (err) {
    console.error("[granola/callback] token exchange threw:", err)
    return errorRedirect("granola_token_failed")
  }
  if ("error" in tokens) {
    console.error("[granola/callback] token exchange failed:", tokens.error)
    return errorRedirect("granola_token_failed")
  }

  const expiresAt = new Date(Date.now() + (tokens.expiresIn ?? 3600) * 1000).toISOString()

  // Best-effort account label — a failure here must not abort the connect.
  let granolaEmail: string | null = null
  try {
    granolaEmail = (await getAccountInfo(tokens.accessToken)).email
  } catch (err) {
    console.warn("[granola/callback] get_account_info failed:", err)
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from("granola_connections").upsert(
    {
      user_id: profile.id,
      access_token: encryptSecret(tokens.accessToken),
      refresh_token: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
      token_expires_at: expiresAt,
      granola_email: granolaEmail,
      oauth_redirect_uri: redirectUri,
      connected_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  )
  if (error) {
    console.error("[granola/callback] upsert error:", error)
    return errorRedirect("granola_save_failed")
  }

  return NextResponse.redirect(
    `${publicOrigin}${returnTo ?? "/b/settings/granola?granola=connected"}`
  )
}
