import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { getCurrentProfile } from "@/lib/auth"
import { z } from "zod"

// Repo coords are interpolated into GitHub API paths downstream (repo-context,
// branches). Constrain them to the GitHub grammar so a "#"/"?"/slash can't
// corrupt a request path or query. Branch names are more permissive (they may
// contain "/") so they are only length-bounded; callers encodeURIComponent them.
const schema = z.object({
  engagement_id: z.string().uuid().optional(),
  repo_id: z.number(),
  repo_full_name: z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/).max(200),
  repo_name: z.string().regex(/^[A-Za-z0-9._-]+$/).max(100),
  repo_owner: z.string().regex(/^[A-Za-z0-9-]+$/).max(100),
  default_branch: z.string().min(1).max(255),
})

export async function POST(request: Request) {
  const profile = await getCurrentProfile()
  if (!profile || profile.role !== "builder") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const parsed = schema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 })
  }

  const { engagement_id, repo_id, repo_full_name, repo_name, repo_owner, default_branch } =
    parsed.data
  const supabase = createAdminClient()

  if (engagement_id) {
    const { error } = await supabase
      .from("engagements")
      .update({
        github_repo_full_name: repo_full_name,
        github_repo_id: repo_id,
        github_repo_name: repo_name,
        github_repo_owner: repo_owner,
        github_default_branch: default_branch,
      })
      .eq("id", engagement_id)
      .eq("builder_id", profile.id)

    if (error) return NextResponse.json({ error: "Failed to save repo" }, { status: 500 })
  } else {
    const { error } = await supabase
      .from("github_connections")
      .update({
        selected_repo_full_name: repo_full_name,
        selected_repo_id: repo_id,
        selected_repo_name: repo_name,
        selected_repo_owner: repo_owner,
        selected_repo_default_branch: default_branch,
      })
      .eq("user_id", profile.id)

    if (error) return NextResponse.json({ error: "Failed to save repo" }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
