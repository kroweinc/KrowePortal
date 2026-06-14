import Link from "next/link"
import { redirect } from "next/navigation"
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { ConnectGitHubButton } from "@/components/github/connect-github-button"
import { RepoSelector } from "@/components/github/repo-selector"
import { decryptSecret } from "@/lib/crypto"
import { fetchGithubRepos } from "@/lib/github/list-repos"
import { fetchGithubProfile } from "@/lib/github/profile"
import type { Engagement } from "@/lib/types"

interface EngagementWithRepo extends Engagement {
  github_repo_full_name: string | null
}

const GH_ERROR_MESSAGES: Record<string, string> = {
  github_denied: "GitHub authorization was cancelled or denied. Please try connecting again.",
  github_token_failed: "Couldn't complete the GitHub handshake. Please try connecting again.",
  github_save_failed: "We couldn't save your GitHub connection. Please try again.",
}

export const metadata = { title: "Repo Settings" };

export default async function GitHubSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ github?: string; error?: string }>
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
  const token = connected && connection?.access_token
    ? decryptSecret(connection.access_token)
    : null
  const [repos, githubProfile] = token
    ? await Promise.all([fetchGithubRepos(token), fetchGithubProfile(token)])
    : [[], null]

  return (
    <main className="mx-auto max-w-6xl px-6 py-10 space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-neutral-900">GitHub settings</h2>
          <p className="mt-0.5 text-sm text-neutral-400">
            Connect your GitHub account and link repos to your clients.{" "}
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

      {params.error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {GH_ERROR_MESSAGES[params.error] ?? "Something went wrong connecting GitHub. Please try again."}
        </div>
      )}

      {connected && githubProfile && (
        <div className="flex items-center gap-4 rounded-lg border border-neutral-200 bg-white p-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={githubProfile.avatarUrl}
            alt={`${githubProfile.login} avatar`}
            width={56}
            height={56}
            className="h-14 w-14 shrink-0 rounded-xl border border-neutral-200 bg-neutral-50 object-contain p-2"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-neutral-900">
              {githubProfile.name ?? githubProfile.login}
            </p>
            <a
              href={githubProfile.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-neutral-500 underline-offset-2 hover:text-neutral-900 hover:underline"
            >
              @{githubProfile.login}
            </a>
            {githubProfile.bio && (
              <p className="mt-1 truncate text-sm text-neutral-400">{githubProfile.bio}</p>
            )}
            <div className="mt-2 flex gap-4 text-xs text-neutral-400">
              <span>
                <span className="font-medium text-neutral-600">{githubProfile.publicRepos}</span> repos
              </span>
              <span>
                <span className="font-medium text-neutral-600">{githubProfile.followers}</span> followers
              </span>
            </div>
          </div>
        </div>
      )}

      {!connected && (
        <p className="text-sm text-neutral-400">
          Connect GitHub above to link repos to your clients.
        </p>
      )}

      {connected && (
        <div className="space-y-4">
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
