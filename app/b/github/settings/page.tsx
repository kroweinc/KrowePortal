import Link from "next/link"
import { redirect } from "next/navigation"
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { ConnectGitHubButton } from "@/components/github/connect-github-button"
import { RepoSelector } from "@/components/github/repo-selector"
import type { Engagement, GitHubRepo } from "@/lib/types"

interface EngagementWithRepo extends Engagement {
  github_repo_full_name: string | null
}

async function fetchGithubRepos(token: string): Promise<GitHubRepo[]> {
  try {
    const res = await fetch(
      "https://api.github.com/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
        cache: "no-store",
      }
    )
    if (!res.ok) return []
    const data = (await res.json()) as GitHubRepo[]
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

export default async function GitHubSettingsPage({
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
    .select("github_username, selected_repo_full_name, access_token")
    .eq("user_id", profile.id)
    .single()

  const { data: engagements } = await supabase
    .from("engagements")
    .select("id, title, created_at, operator_id, builder_id, github_repo_full_name")
    .eq("builder_id", profile.id)
    .order("created_at", { ascending: true })

  const engagementList = (engagements ?? []) as EngagementWithRepo[]
  const connected = !!connection
  const repos = connected && connection?.access_token
    ? await fetchGithubRepos(connection.access_token)
    : []

  return (
    <main className="mx-auto max-w-6xl px-6 py-10 space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-neutral-900">GitHub settings</h2>
          <p className="mt-0.5 text-sm text-neutral-400">
            Connect your GitHub account and link repos to your engagements.{" "}
            <Link href="/b/github" className="text-neutral-600 underline underline-offset-2 hover:text-neutral-900">
              Back to project
            </Link>
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
            <RepoSelector
              currentRepo={connection?.selected_repo_full_name ?? null}
              initialRepos={repos}
            />
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
                initialRepos={repos}
              />
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
