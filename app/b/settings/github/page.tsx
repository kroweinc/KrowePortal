import { redirect } from "next/navigation"
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { ConnectGitHubButton } from "@/components/github/connect-github-button"
import { RepoSelector } from "@/components/github/repo-selector"
import { SettingsHeader, SettingsSection } from "@/components/settings/settings-section"
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

export const metadata = { title: "GitHub · Settings" }

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
    <div className="krowe-set-stack">
      <SettingsHeader title="GitHub" sub="Connect your account and link repos to your clients." />

      {params.github === "connected" && (
        <div className="krowe-set-banner success">GitHub connected successfully.</div>
      )}

      {params.error && (
        <div className="krowe-set-banner error">
          {GH_ERROR_MESSAGES[params.error] ?? "Something went wrong connecting GitHub. Please try again."}
        </div>
      )}

      <SettingsSection title="Connection" hint="Link your GitHub account to sync repos and stats.">
        <ConnectGitHubButton connected={connected} username={connection?.github_username} />

        {connected && githubProfile && (
          <div className="krowe-set-gh-profile">
            <span className="krowe-set-gh-avatar">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={githubProfile.avatarUrl}
                alt={`${githubProfile.login} avatar`}
                width={54}
                height={54}
              />
            </span>
            <div className="min-w-0 flex-1">
              <p className="krowe-set-gh-name truncate">
                {githubProfile.name ?? githubProfile.login}
              </p>
              <a
                href={githubProfile.htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="krowe-set-gh-handle hover:underline"
              >
                @{githubProfile.login}
              </a>
              {githubProfile.bio && (
                <p className="krowe-set-gh-handle mt-1 truncate">{githubProfile.bio}</p>
              )}
              <div className="krowe-set-gh-stats">
                <span>
                  <b>{githubProfile.publicRepos}</b> repos
                </span>
                <span>
                  <b>{githubProfile.followers}</b> followers
                </span>
              </div>
            </div>
          </div>
        )}

        {!connected && (
          <p className="krowe-set-note" style={{ marginTop: "10px" }}>
            Connect GitHub above to link repos to your clients.
          </p>
        )}
      </SettingsSection>

      {connected && (
        <SettingsSection title="Repositories" hint="Link a repo to each client to track commits against tasks.">
          {engagementList.length === 0 ? (
            <div className="krowe-set-empty" style={{ padding: "18px 16px" }}>
              <p className="krowe-set-empty-title">No clients yet</p>
              <p className="krowe-set-empty-body">
                Repos can be linked once you have a client.
              </p>
            </div>
          ) : (
            <div>
              {engagementList.map((engagement) => (
                <div key={engagement.id} className="krowe-set-repo-block">
                  <p className="krowe-set-repo-name">{engagement.title}</p>
                  <RepoSelector
                    engagementId={engagement.id}
                    currentRepo={engagement.github_repo_full_name}
                    initialRepos={repos}
                  />
                </div>
              ))}
            </div>
          )}
        </SettingsSection>
      )}
    </div>
  )
}
