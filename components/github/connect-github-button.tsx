"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { disconnectGithub } from "@/lib/actions/github"

interface ConnectGitHubButtonProps {
  connected: boolean
  username?: string | null
}

export function ConnectGitHubButton({ connected, username }: ConnectGitHubButtonProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function handleDisconnect() {
    if (!window.confirm("Disconnect your GitHub account? You can reconnect anytime.")) return
    startTransition(async () => {
      await disconnectGithub()
      router.refresh()
    })
  }

  if (connected) {
    return (
      <div className="flex items-center gap-3 text-sm text-neutral-600">
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-green-500" />
          GitHub connected{username ? ` as @${username}` : ""}
        </span>
        <button
          type="button"
          onClick={handleDisconnect}
          disabled={isPending}
          className="text-xs text-neutral-400 underline underline-offset-2 transition-colors hover:text-red-600 disabled:opacity-50"
        >
          {isPending ? "Disconnecting…" : "Disconnect"}
        </button>
      </div>
    )
  }

  return (
    <a
      href="/api/github/connect"
      className="inline-flex items-center gap-2 rounded-md bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700 transition-colors"
    >
      Connect GitHub
    </a>
  )
}
