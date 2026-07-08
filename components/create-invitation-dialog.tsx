"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createInvitation } from "@/lib/actions/invitations";

interface Props {
  existingToken?: string;
  engagementId?: string;
}

export function CreateInvitationDialog({ existingToken, engagementId }: Props) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(existingToken ?? null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const inviteUrl =
    token && typeof window !== "undefined" ? `${window.location.origin}/join/${token}` : null;

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const result = await createInvitation(engagementId);
      if ("error" in result) {
        setError(result.error);
      } else {
        setToken(result.token);
      }
    });
  }

  function handleCopy() {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl).then(() => {
      toast.success("Link copied to clipboard");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Invite operator
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite your operator</DialogTitle>
        </DialogHeader>

        {!token ? (
          <div className="space-y-4 pt-2">
            <p className="text-sm text-neutral-500">
              Generate a link and share it with your operator. Once they sign in, they&apos;ll join your
              shared space and can see your tasks.
            </p>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <Button onClick={handleCreate} disabled={isPending} className="w-full">
              {isPending ? "Creating link…" : "Create invite link"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            <p className="text-sm text-neutral-500">
              Share this link with your operator. It expires in 7 days.
            </p>
            <div className="flex gap-2">
              <Input value={inviteUrl ?? ""} readOnly className="font-mono text-xs" />
              <Button variant="outline" onClick={handleCopy} className="shrink-0">
                Copy
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
