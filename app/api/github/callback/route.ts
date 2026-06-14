import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { createAdminClient } from "@/lib/supabase/server"
import { getCurrentProfile } from "@/lib/auth"
import { getPublicAppOrigin } from "@/lib/app-origin"
import { encryptSecret } from "@/lib/crypto"
import { getGithubOAuthConfig } from "@/lib/github/oauth-config"
import { GH_OAUTH_STATE_COOKIE, GH_OAUTH_RETURN_COOKIE } from "../connect/route"

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const publicOrigin = getPublicAppOrigin(origin)
  const code = searchParams.get("code")
  const state = searchParams.get("state")

  // CSRF: the returned state must match the nonce we set at connect time.
  const cookieStore = await cookies()
  const expectedState = cookieStore.get(GH_OAUTH_STATE_COOKIE)?.value
  cookieStore.set(GH_OAUTH_STATE_COOKIE, "", { maxAge: 0, path: "/" })

  // Optional caller-provided destination (validated relative path, set by
  // connect/route.ts) — lets flows like the onboarding wizard get the user
  // back where they started instead of the GitHub settings page.
  const rawReturnTo = cookieStore.get(GH_OAUTH_RETURN_COOKIE)?.value
  cookieStore.set(GH_OAUTH_RETURN_COOKIE, "", { maxAge: 0, path: "/" })
  const returnTo =
    rawReturnTo && rawReturnTo.startsWith("/") && !rawReturnTo.startsWith("//")
      ? rawReturnTo
      : null
  // Failures land on the GitHub settings page (which renders an error banner)
  // unless a caller-provided returnTo handles its own errors (e.g. onboarding).
  const errorRedirect = (codeName: string) =>
    NextResponse.redirect(`${publicOrigin}${returnTo ?? "/b/github/settings"}?error=${codeName}`)

  if (!code || !state || !expectedState || state !== expectedState) {
    return errorRedirect("github_denied")
  }

  // Identity is taken from the authenticated session — never from the URL.
  const profile = await getCurrentProfile()
  if (!profile) {
    return NextResponse.redirect(`${publicOrigin}/login`)
  }

  const { clientId, clientSecret, redirectUri } = getGithubOAuthConfig(publicOrigin)
  if (!clientId || !clientSecret || !redirectUri) {
    console.error("[github/callback] missing GitHub OAuth env vars")
    return errorRedirect("github_token_failed")
  }

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  })

  const tokenData = await tokenRes.json()
  if (tokenData.error || !tokenData.access_token) {
    return errorRedirect("github_token_failed")
  }

  const githubUserRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: "application/vnd.github+json",
    },
  })
  const githubUser = await githubUserRes.json()

  const supabase = createAdminClient()
  const { error } = await supabase
    .from("github_connections")
    .upsert(
      {
        user_id: profile.id,
        access_token: encryptSecret(tokenData.access_token),
        github_username: githubUser.login,
        github_user_id: githubUser.id,
      },
      { onConflict: "user_id" }
    )

  if (error) {
    console.error("[github/callback] upsert error:", error)
    return errorRedirect("github_save_failed")
  }

  return NextResponse.redirect(
    `${publicOrigin}${returnTo ?? "/b/github/settings?github=connected"}`
  )
}
