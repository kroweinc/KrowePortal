import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const state = searchParams.get("state")

  if (!code || !state) {
    return NextResponse.redirect(`${origin}/b?error=github_denied`)
  }

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: process.env.GITHUB_REDIRECT_URI,
    }),
  })

  const tokenData = await tokenRes.json()
  if (tokenData.error || !tokenData.access_token) {
    return NextResponse.redirect(`${origin}/b?error=github_token_failed`)
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
        user_id: state,
        access_token: tokenData.access_token,
        github_username: githubUser.login,
        github_user_id: githubUser.id,
      },
      { onConflict: "user_id" }
    )

  if (error) {
    console.error("[github/callback] upsert error:", error)
    return NextResponse.redirect(`${origin}/b?error=github_save_failed`)
  }

  return NextResponse.redirect(`${origin}/b/github?github=connected`)
}
