import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { randomBytes } from "crypto"
import { getCurrentProfile } from "@/lib/auth"
import { getPublicAppOrigin } from "@/lib/app-origin"
import {
  GRANOLA_AUTH_BASE,
  GRANOLA_MCP_RESOURCE,
  GRANOLA_SCOPES,
  createPkcePair,
  ensureRegisteredClient,
  resolveGranolaRedirectUri,
} from "@/lib/granola/oauth"

export const GRANOLA_OAUTH_STATE_COOKIE = "granola_oauth_state"
export const GRANOLA_PKCE_VERIFIER_COOKIE = "granola_pkce_verifier"
export const GRANOLA_OAUTH_RETURN_COOKIE = "granola_oauth_return"

const OAUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 600,
} as const

export async function GET(request: Request) {
  const profile = await getCurrentProfile()
  if (!profile) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (profile.role !== "builder") {
    return NextResponse.json({ error: "Only builders can connect Granola." }, { status: 403 })
  }

  const requestOrigin = new URL(request.url).origin
  const publicOrigin = getPublicAppOrigin(requestOrigin)
  const redirectUri = resolveGranolaRedirectUri(publicOrigin)
  if (!redirectUri) {
    return NextResponse.json(
      { error: "Granola OAuth redirect URI could not be resolved. Set GRANOLA_REDIRECT_URI or APP_ORIGIN." },
      { status: 500 }
    )
  }

  let client
  try {
    client = await ensureRegisteredClient(redirectUri)
  } catch (err) {
    console.error("[granola/connect] client registration failed:", err)
    return NextResponse.redirect(
      `${publicOrigin}/b/settings/granola?error=granola_registration_failed`
    )
  }

  // CSRF nonce — opaque and unguessable. The user is identified by their
  // session in the callback, NOT by this value, so it carries no identity.
  const state = randomBytes(16).toString("hex")
  const { verifier, challenge } = createPkcePair()

  const cookieStore = await cookies()
  cookieStore.set(GRANOLA_OAUTH_STATE_COOKIE, state, OAUTH_COOKIE_OPTIONS)
  cookieStore.set(GRANOLA_PKCE_VERIFIER_COOKIE, verifier, OAUTH_COOKIE_OPTIONS)

  // Where to land after the round-trip. Relative paths only — same
  // open-redirect guard as app/api/github/connect/route.ts.
  const returnTo = new URL(request.url).searchParams.get("returnTo")
  if (returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")) {
    cookieStore.set(GRANOLA_OAUTH_RETURN_COOKIE, returnTo, OAUTH_COOKIE_OPTIONS)
  }

  const params = new URLSearchParams({
    response_type: "code",
    client_id: client.clientId,
    redirect_uri: redirectUri,
    scope: GRANOLA_SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: GRANOLA_MCP_RESOURCE,
  })

  return NextResponse.redirect(`${GRANOLA_AUTH_BASE}/oauth2/authorize?${params.toString()}`)
}
