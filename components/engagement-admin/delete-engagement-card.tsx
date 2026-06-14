"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { deleteEngagement } from "@/lib/actions/invitations";
import type { Engagement } from "@/lib/types";

export function DeleteEngagementCard({ engagement }: { engagement: Engagement }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [deleteOpen, setDeleteOpen] = useState(false);

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteEngagement(engagement.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Client deleted");
      router.push("/b/engagements");
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-neutral-500">
          Permanently delete this client and everything in it.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDeleteOpen(true)}
          className="shrink-0 text-red-600 hover:bg-red-50 hover:text-red-700"
        >
          Delete client
        </Button>
      </div>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{engagement.title}&rdquo;?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2 text-sm text-neutral-600">
            <p>
              This permanently deletes the client along with its tasks, milestones, briefs,
              deliverables, change orders, operating agreement, invitations, and availability.
              This can&apos;t be undone.
            </p>
            {engagement.project_id && (
              <p>The linked project is kept and can start a new client later.</p>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDelete}
              disabled={isPending}
              className="text-red-600 hover:bg-red-50 hover:text-red-700"
            >
              {isPending ? "Deleting…" : "Delete client"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
