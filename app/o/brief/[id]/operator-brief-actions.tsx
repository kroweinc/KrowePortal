"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { acceptBrief, rejectBrief } from "@/lib/actions/briefs";

export function OperatorBriefActions({ briefId }: { briefId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [note, setNote] = useState("");

  function handleAccept() {
    if (!confirm("Accept this brief? This commits you to the scope and pricing above.")) return;
    startTransition(async () => {
      const result = await acceptBrief(briefId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Brief accepted");
      router.refresh();
    });
  }

  function handleReject() {
    startTransition(async () => {
      const result = await rejectBrief(briefId, note.trim() || null);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Brief rejected");
      setRejectOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" onClick={() => setRejectOpen(true)} disabled={isPending}>
          Reject
        </Button>
        <Button onClick={handleAccept} disabled={isPending}>
          {isPending ? "Working…" : "Accept brief"}
        </Button>
      </div>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject this brief?</DialogTitle>
            <DialogDescription>
              Leave a short note for your builder explaining what's off. They can revise and re-send.
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 py-4">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="e.g. Timeline is too tight, please push to Q4; remove the migration line item."
              disabled={isPending}
              className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:ring-offset-1 disabled:opacity-40 resize-none"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleReject} disabled={isPending}>
              {isPending ? "Rejecting…" : "Reject brief"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
