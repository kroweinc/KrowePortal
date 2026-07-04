"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import type { GitHubRepo } from "@/lib/types"

interface RepoSelectorProps {
  engagementId?: string
  currentRepo?: string | null
  initialRepos?: GitHubRepo[]
}

export function RepoSelector({ engagementId, currentRepo, initialRepos }: RepoSelectorProps) {
  const router = useRouter()
  const [repos, setRepos] = useState<GitHubRepo[]>(initialRepos ?? [])
  const [selected, setSelected] = useState<string>(currentRepo ?? "")
  const [loading, setLoading] = useState(!initialRepos)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [needsReconnect, setNeedsReconnect] = useState(false)

  useEffect(() => {
    if (initialRepos) return
    fetch("/api/github/repos")
      .then((r) => r.json())
      .then((data) => {
        setRepos(Array.isArray(data?.repos) ? data.repos : [])
        setNeedsReconnect(!!data?.needsReconnect)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [initialRepos])

  async function handleSelect(fullName: string) {
    const repo = repos.find((r) => r.full_name === fullName)
    if (!repo) return
    setSelected(fullName)
    setSaving(true)
    const body: Record<string, unknown> = {
      repo_id: repo.id,
      repo_full_name: repo.full_name,
      repo_name: repo.name,
      repo_owner: repo.owner.login,
      default_branch: repo.default_branch,
    }
    if (engagementId) body.engagement_id = engagementId
    const res = await fetch("/api/github/repos/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    setSaving(false)
    if (res.ok) {
      setSaved(true)
      router.refresh()
    }
  }

  if (loading) return <p className="krowe-set-note">Loading repos...</p>

  if (needsReconnect) {
    return (
      <div>
        <p className="krowe-set-repo-sub">Connected repository</p>
        <p className="krowe-set-note" style={{ fontSize: "13px" }}>
          Your GitHub connection expired.{" "}
          <a href="/api/github/connect" className="krowe-set-link-muted">
            Reconnect GitHub
          </a>{" "}
          to pick a repository.
        </p>
      </div>
    )
  }

  return (
    <div>
      <p className="krowe-set-repo-sub">Connected repository</p>
      <select
        value={selected}
        onChange={(e) => handleSelect(e.target.value)}
        className="krowe-set-select"
        disabled={saving}
      >
        <option value="">Select a repository...</option>
        {repos.map((repo) => (
          <option key={repo.id} value={repo.full_name}>
            {repo.full_name}
            {repo.private ? " (private)" : ""}
          </option>
        ))}
      </select>
      {saving && <p className="krowe-set-note" style={{ marginTop: "6px" }}>Saving...</p>}
      {!saving && saved && (
        <p className="krowe-set-note" style={{ marginTop: "6px", color: "var(--success)" }}>Saved</p>
      )}
    </div>
  )
}
