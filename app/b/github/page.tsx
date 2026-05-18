import { redirect } from "next/navigation"
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { ConnectGitHubButton } from "@/components/github/connect-github-button"
import { RepoSelector } from "@/components/github/repo-selector"
import type { Engagement } from "@/lib/types"

interface EngagementWithRepo extends Engagement {
  github_repo_full_name: string | null
}

export default async function GitHubPage({
  searchParams,
}: {
  searchParams: Promise<{ github?: string }>
}) {
  const params = await searchParams
  const profile = await getCurrentProfile()
  if (!profile) redirect("/login")
  if (profile.role !== "builder") redirect("/o")

  const supabase = DEV_PROFILE_IDS.has(profile.id)
    ? createAdminClient()
    : await createClient()

  const { data: connection } = await supabase
    .from("github_connections")
    .select("github_username, selected_repo_full_name")
    .eq("user_id", profile.id)
    .single()

  const { data: engagements } = await supabase
    .from("engagements")
    .select("id, title, created_at, operator_id, builder_id, github_repo_full_name")
    .eq("builder_id", profile.id)
    .order("created_at", { ascending: true })

  const engagementList = (engagements ?? []) as EngagementWithRepo[]
  const connected = !!connection

  return (
    <main className="mx-auto max-w-6xl px-6 py-10 space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-neutral-900">GitHub</h2>
          <p className="mt-0.5 text-sm text-neutral-400">
            Connect your GitHub account and link repos to your engagements.
          </p>
        </div>
        <ConnectGitHubButton connected={connected} username={connection?.github_username} />
      </div>

      {params.github === "connected" && (
        <div className="rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
          GitHub connected successfully.
        </div>
      )}

      {!connected && (
        <p className="text-sm text-neutral-400">
          Connect GitHub above to link repos to your engagements.
        </p>
      )}

      {connected && (
        <div className="space-y-4">
          <div className="rounded-lg border border-neutral-200 bg-white p-5 space-y-3">
            <p className="text-sm font-medium text-neutral-900">Default Repository</p>
            <RepoSelector currentRepo={connection?.selected_repo_full_name ?? null} />
          </div>

          {engagementList.map((engagement) => (
            <div
              key={engagement.id}
              className="rounded-lg border border-neutral-200 bg-white p-5 space-y-3"
            >
              <p className="text-sm font-medium text-neutral-900">{engagement.title}</p>
              <RepoSelector
                engagementId={engagement.id}
                currentRepo={engagement.github_repo_full_name}
              />
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
