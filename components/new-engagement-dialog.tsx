"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { createEngagement, createInvitation } from "@/lib/actions/invitations";

export function NewEngagementDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const inviteUrl = token ? `${window.location.origin}/join/${token}` : null;

  function handleCreate() {
    if (!title.trim()) {
      setError("Give the client a name first.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createEngagement(title.trim());
      if ("error" in result) {
        setError(result.error);
        return;
      }
      const invite = await createInvitation(result.engagement.id);
      if ("error" in invite) {
        // Engagement exists but invite minting failed — still usable from the list
        setError(invite.error);
      } else {
        setToken(invite.token);
      }
      router.refresh();
    });
  }

  function handleCopy() {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl).then(() => {
      toast.success("Link copied to clipboard");
    });
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setTitle("");
      setToken(null);
      setError(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">New client</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New client</DialogTitle>
        </DialogHeader>

        {!token ? (
          <div className="space-y-4 pt-2">
            <p className="text-sm text-neutral-500">
              Start a new shared space for another business owner. You&apos;ll get an invite link
              to send them.
            </p>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Client name (e.g. Acme rebuild)"
              maxLength={120}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <Button onClick={handleCreate} disabled={isPending} className="w-full">
              {isPending ? "Creating…" : "Create client"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            <p className="text-sm text-neutral-500">
              <span className="font-medium text-neutral-900">{title}</span> is ready. Share this
              link with the business owner — it expires in 7 days.
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
