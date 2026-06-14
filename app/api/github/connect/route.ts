import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { randomBytes } from "crypto"
import { getCurrentProfile } from "@/lib/auth"
import { getPublicAppOrigin } from "@/lib/app-origin"
import { getGithubOAuthConfig } from "@/lib/github/oauth-config"

export const GH_OAUTH_STATE_COOKIE = "gh_oauth_state"
export const GH_OAUTH_RETURN_COOKIE = "gh_oauth_return"

export async function GET(request: Request) {
  const profile = await getCurrentProfile()
  if (!profile) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // CSRF nonce — opaque and unguessable. The user is identified by their
  // session in the callback, NOT by this value, so it carries no identity.
  const state = randomBytes(16).toString("hex")
  const cookieStore = await cookies()
  cookieStore.set(GH_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  })

  // Where to land after the round-trip (e.g. /onboarding). Relative paths
  // only — same open-redirect guard as app/auth/callback/route.ts.
  const returnTo = new URL(request.url).searchParams.get("returnTo")
  if (returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")) {
    cookieStore.set(GH_OAUTH_RETURN_COOKIE, returnTo, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 600,
    })
  }

  const requestOrigin = new URL(request.url).origin
  const publicOrigin = getPublicAppOrigin(requestOrigin)
  const { clientId, redirectUri } = getGithubOAuthConfig(publicOrigin)
  if (!clientId || !redirectUri) {
    return NextResponse.json(
      {
        error:
          "GitHub OAuth is not configured. Set GITHUB_CLIENT_ID (and GITHUB_REDIRECT_URI, or deploy on Vercel production).",
      },
      { status: 500 }
    )
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "repo read:user",
    state,
  })

  return NextResponse.redirect(
    `https://github.com/login/oauth/authorize?${params.toString()}`
  )
}
