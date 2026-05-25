"use client"

import { useEffect, useState } from "react"
import type { GitHubRepo } from "@/lib/types"

interface RepoSelectorProps {
  engagementId?: string
  currentRepo?: string | null
  initialRepos?: GitHubRepo[]
}

export function RepoSelector({ engagementId, currentRepo, initialRepos }: RepoSelectorProps) {
  const [repos, setRepos] = useState<GitHubRepo[]>(initialRepos ?? [])
  const [selected, setSelected] = useState<string>(currentRepo ?? "")
  const [loading, setLoading] = useState(!initialRepos)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (initialRepos) return
    fetch("/api/github/repos")
      .then((r) => r.json())
      .then((data) => {
        setRepos(data.repos ?? [])
        setLoading(false)
      })
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
    await fetch("/api/github/repos/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    setSaving(false)
  }

  if (loading) return <p className="text-sm text-neutral-400">Loading repos...</p>

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-medium text-neutral-500">Connected repository</label>
      <select
        value={selected}
        onChange={(e) => handleSelect(e.target.value)}
        className="rounded-md border border-neutral-200 px-3 py-2 text-sm text-neutral-900 bg-white disabled:opacity-50"
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
      {saving && <p className="text-xs text-neutral-400">Saving...</p>}
    </div>
  )
}
