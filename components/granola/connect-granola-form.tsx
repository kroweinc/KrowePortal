"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Unlink, Unplug } from "lucide-react";
import { disconnectGranola } from "@/lib/actions/granola";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { GranolaLogo } from "@/components/granola/granola-logo";

// Connecting is an OAuth round-trip through /api/granola/connect — no
// secrets ever pass through the browser form (mirrors connect-github-button).

interface ConnectGranolaFormProps {
  connected: boolean;
  connectedAt: string | null;
  granolaEmail: string | null;
  needsReconnect: boolean;
}

export function ConnectGranolaForm({
  connected,
  connectedAt,
  granolaEmail,
  needsReconnect,
}: ConnectGranolaFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirm, confirmDialog] = useConfirm();

  async function handleDisconnect() {
    if (
      !(await confirm({
        title: "Disconnect Granola?",
        description:
          "Your Granola account will be unlinked. Calls you already imported stay in place. You can reconnect anytime.",
        confirmText: "Disconnect",
        cancelText: "Cancel",
        tone: "danger",
        icon: Unlink,
      }))
    )
      return;
    startTransition(async () => {
      await disconnectGranola();
      router.refresh();
    });
  }

  const badge = connected ? (
    needsReconnect ? (
      <span className="krowe-set-badge warn">
        <span className="bd" />
        Connection expired
      </span>
    ) : (
      <span className="krowe-set-badge on">
        <span className="bd" />
        Connected
      </span>
    )
  ) : (
    <span className="krowe-set-badge off">
      <span className="bd" />
      Not connected
    </span>
  );

  return (
    <section className="krowe-set-card">
      <div className="krowe-set-integration">
        <span className="krowe-set-int-logo granola">
          <GranolaLogo />
        </span>

        <div className="krowe-set-int-body">
          <div className="krowe-set-int-name-row">
            <span className="krowe-set-int-name">Granola</span>
            {badge}
          </div>
          <p className="krowe-set-int-desc">
            Pull meeting summaries and transcripts into your documents and tasks.
          </p>
          {connected ? (
            <div className="krowe-set-int-meta">
              {granolaEmail && <span className="mono">{granolaEmail}</span>}
              {granolaEmail && connectedAt && <span className="sep">·</span>}
              {connectedAt && <span>since {new Date(connectedAt).toLocaleDateString()}</span>}
            </div>
          ) : (
            <div className="krowe-set-int-meta">
              <span>
                You&apos;ll be sent to Granola to approve access, then brought back here. No
                API keys to copy — access is scoped to your account and revocable anytime.
              </span>
            </div>
          )}
        </div>

        <div className="krowe-set-int-aside">
          {connected ? (
            <>
              {needsReconnect && (
                <a href="/api/granola/connect" className="krowe-set-btn-dark">
                  Reconnect
                </a>
              )}
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={isPending}
                className={needsReconnect ? "krowe-set-link-muted danger" : "krowe-set-btn-outline"}
              >
                {!needsReconnect && <Unplug size={15} strokeWidth={1.9} />}
                {isPending ? "Disconnecting…" : "Disconnect"}
              </button>
            </>
          ) : (
            <a href="/api/granola/connect" className="krowe-set-btn-dark">
              Connect Granola
            </a>
          )}
        </div>
      </div>
      {confirmDialog}
    </section>
  );
}
