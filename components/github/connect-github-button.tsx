"use client"

interface ConnectGitHubButtonProps {
  connected: boolean
  username?: string | null
}

export function ConnectGitHubButton({ connected, username }: ConnectGitHubButtonProps) {
  if (connected) {
    return (
      <div className="flex items-center gap-2 text-sm text-neutral-600">
        <span className="h-2 w-2 rounded-full bg-green-500" />
        GitHub connected{username ? ` as @${username}` : ""}
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
