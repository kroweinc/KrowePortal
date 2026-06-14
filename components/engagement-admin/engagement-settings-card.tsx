"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createInvitation,
  renameEngagement,
  removeOperator,
  revokeInvitation,
  type PendingInvite,
} from "@/lib/actions/invitations";
import type { Engagement } from "@/lib/types";

export function EngagementSettingsCard({
  engagement,
  pendingInvite,
}: {
  engagement: Engagement;
  pendingInvite: PendingInvite | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [title, setTitle] = useState(engagement.title);
  const [token, setToken] = useState<string | null>(pendingInvite?.token ?? null);

  // Origin is read after mount so server and client render the same initial markup.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const trimmed = title.trim();
  const dirty = trimmed !== engagement.title.trim();
  const operatorName = engagement.operator?.display_name ?? null;
  const inviteUrl = token && origin ? `${origin}/join/${token}` : null;

  function handleRename() {
    startTransition(async () => {
      const result = await renameEngagement(engagement.id, trimmed);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Client renamed");
      router.refresh();
    });
  }

  function handleRemoveOperator() {
    const confirmed = window.confirm(
      `Remove ${operatorName ?? "the operator"} from this client? They'll lose access to its dashboard, but their tasks and materials are kept. You can invite someone new afterward.`
    );
    if (!confirmed) return;
    startTransition(async () => {
      const result = await removeOperator(engagement.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Operator removed");
      router.refresh();
    });
  }

  function handleCreateInvite() {
    startTransition(async () => {
      const result = await createInvitation(engagement.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setToken(result.token);
      router.refresh();
    });
  }

  function handleCopy() {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl).then(() => {
      toast.success("Link copied to clipboard");
    });
  }

  function handleRevoke() {
    if (!window.confirm("Revoke this invite link? Anyone holding it won't be able to join.")) return;
    startTransition(async () => {
      const result = await revokeInvitation(engagement.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setToken(null);
      toast.success("Invite link revoked");
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {/* Rename */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-neutral-700">Name</p>
        <div className="flex gap-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Client name"
            maxLength={120}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleRename}
            disabled={!dirty || trimmed.length === 0 || isPending}
            className="shrink-0 self-center"
          >
            {isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {/* Operator & invitations */}
      <div className="space-y-2 border-t border-neutral-100 pt-4">
        <p className="text-xs font-medium text-neutral-700">Operator</p>
        {operatorName ? (
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-sm text-neutral-500">
              <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
              Connected with {operatorName}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRemoveOperator}
              disabled={isPending}
              className="text-red-600 hover:bg-red-50 hover:text-red-700"
            >
              Remove operator
            </Button>
          </div>
        ) : token ? (
          <div className="space-y-2">
            <p className="text-sm text-neutral-500">
              Share this link with your operator.
              {pendingInvite?.token === token && pendingInvite?.expires_at
                ? ` Expires ${new Date(pendingInvite.expires_at).toLocaleDateString()}.`
                : " It expires in 7 days."}
            </p>
            <div className="flex gap-2">
              <Input value={inviteUrl ?? ""} readOnly className="font-mono text-xs" />
              <Button variant="outline" size="sm" onClick={handleCopy} className="shrink-0 self-center">
                Copy
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRevoke}
                disabled={isPending}
                className="shrink-0 self-center text-red-600 hover:bg-red-50 hover:text-red-700"
              >
                Revoke
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-neutral-500">No operator yet — create a link to invite one.</p>
            <Button variant="outline" size="sm" onClick={handleCreateInvite} disabled={isPending}>
              {isPending ? "Creating…" : "Create invite link"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
