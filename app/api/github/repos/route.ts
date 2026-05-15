import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { getCurrentProfile } from "@/lib/auth"
import type { GitHubRepo } from "@/lib/types"

export async function GET() {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = createAdminClient()
  const { data: connection } = await supabase
    .from("github_connections")
    .select("access_token")
    .eq("user_id", profile.id)
    .single()

  if (!connection) {
    return NextResponse.json({ error: "GitHub not connected" }, { status: 400 })
  }

  const reposRes = await fetch(
    "https://api.github.com/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator",
    {
      headers: {
        Authorization: `Bearer ${connection.access_token}`,
        Accept: "application/vnd.github+json",
      },
    }
  )

  const repos: GitHubRepo[] = await reposRes.json()
  return NextResponse.json({ repos })
}
