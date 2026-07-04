"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Unlink } from "lucide-react"
import { disconnectGithub } from "@/lib/actions/github"
import { useConfirm } from "@/components/ui/confirm-dialog"

interface ConnectGitHubButtonProps {
  connected: boolean
  username?: string | null
}

export function ConnectGitHubButton({ connected, username }: ConnectGitHubButtonProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [confirm, confirmDialog] = useConfirm()

  async function handleDisconnect() {
    if (
      !(await confirm({
        title: "Disconnect GitHub?",
        description: "Your linked GitHub account will be removed. You can reconnect anytime.",
        confirmText: "Disconnect",
        cancelText: "Cancel",
        tone: "danger",
        icon: Unlink,
      }))
    )
      return
    startTransition(async () => {
      await disconnectGithub()
      router.refresh()
    })
  }

  if (connected) {
    return (
      <div className="krowe-set-conn-line">
        <span className="krowe-set-conn-dot" />
        <span>
          GitHub connected{username ? <> as <b style={{ fontWeight: 600 }}>@{username}</b></> : ""}
        </span>
        <button
          type="button"
          onClick={handleDisconnect}
          disabled={isPending}
          className="krowe-set-link-muted danger"
        >
          {isPending ? "Disconnecting…" : "Disconnect"}
        </button>
        {confirmDialog}
      </div>
    )
  }

  return (
    <div className="krowe-set-conn-line">
      <span className="krowe-set-conn-dot off" />
      <span>Not connected</span>
      <a href="/api/github/connect" className="krowe-set-btn-dark" style={{ marginLeft: "auto" }}>
        Connect GitHub
      </a>
    </div>
  )
}
