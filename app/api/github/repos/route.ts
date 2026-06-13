import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { getCurrentProfile } from "@/lib/auth"
import { decryptSecret } from "@/lib/crypto"
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
        Authorization: `Bearer ${decryptSecret(connection.access_token)}`,
        Accept: "application/vnd.github+json",
      },
      cache: "no-store",
    }
  )

  // A stored token that GitHub rejects (expired/revoked) returns a 401/403 JSON
  // *object*, not an array — forwarding it would crash `repos.map` on the
  // client. Signal a reconnect instead of returning malformed data.
  if (reposRes.status === 401 || reposRes.status === 403) {
    return NextResponse.json({ repos: [], needsReconnect: true })
  }
  if (!reposRes.ok) {
    return NextResponse.json({ repos: [] }, { status: 502 })
  }

  const data = await reposRes.json()
  const repos: GitHubRepo[] = Array.isArray(data) ? data : []
  return NextResponse.json({ repos })
}
