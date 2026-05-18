import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { getCurrentProfile } from "@/lib/auth"
import { z } from "zod"

const schema = z.object({
  repo_id: z.number(),
  repo_full_name: z.string(),
  repo_name: z.string(),
  repo_owner: z.string(),
  default_branch: z.string(),
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

  const { repo_id, repo_full_name, repo_name, repo_owner, default_branch } = parsed.data
  const supabase = createAdminClient()

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

  return NextResponse.json({ success: true })
}
