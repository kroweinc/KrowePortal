"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
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
import { beginEngagement, type BeginEngagementResult } from "@/lib/actions/begin-engagement";

interface BeginEngagementDialogProps {
  projectId: string;
  projectName: string;
  prospectEmail: string | null;
  contractSigned: boolean;
  signedQuote: { title: string; milestoneCount: number; taskCount: number } | null;
}

type Success = Exclude<BeginEngagementResult, { error: string }>;

export function BeginEngagementDialog({
  projectId,
  projectName,
  prospectEmail,
  contractSigned,
  signedQuote,
}: BeginEngagementDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(projectName);
  const [seedTasks, setSeedTasks] = useState(signedQuote !== null);
  const [createInvite, setCreateInvite] = useState(true);
  const [result, setResult] = useState<Success | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const inviteUrl = result?.inviteToken
    ? `${window.location.origin}/join/${result.inviteToken}`
    : null;

  function handleBegin() {
    if (!title.trim()) {
      setError("Give the engagement a name first.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await beginEngagement({
        projectId,
        title: title.trim(),
        seedTasks: seedTasks && signedQuote !== null,
        createInvite,
      });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setResult(res);
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
      setTitle(projectName);
      setSeedTasks(signedQuote !== null);
      setCreateInvite(true);
      setResult(null);
      setError(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {contractSigned ? (
          <Button size="sm">Begin engagement</Button>
        ) : (
          <Button variant="outline" size="sm">
            Begin engagement early
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Begin engagement</DialogTitle>
        </DialogHeader>

        {!result ? (
          <div className="space-y-4 pt-2">
            <p className="text-sm text-neutral-500">
              Turn this project into a live engagement with a task board and repo.
            </p>
            {!contractSigned && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
                No signed contract yet — you can still start, but the pipeline recommends
                signing first.
              </p>
            )}
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Engagement name"
              maxLength={120}
              onKeyDown={(e) => e.key === "Enter" && handleBegin()}
            />

            <label className="flex items-start gap-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={seedTasks && signedQuote !== null}
                disabled={signedQuote === null}
                onChange={(e) => setSeedTasks(e.target.checked)}
              />
              <span>
                Seed milestones &amp; tasks from the signed quote
                {signedQuote ? (
                  <span className="block text-xs text-neutral-500">
                    “{signedQuote.title}” — {signedQuote.milestoneCount}{" "}
                    {signedQuote.milestoneCount === 1 ? "milestone" : "milestones"},{" "}
                    {signedQuote.taskCount} {signedQuote.taskCount === 1 ? "task" : "tasks"}
                  </span>
                ) : (
                  <span className="block text-xs text-neutral-400">No signed quote yet.</span>
                )}
              </span>
            </label>

            <label className="flex items-start gap-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={createInvite}
                onChange={(e) => setCreateInvite(e.target.checked)}
              />
              <span>
                Create invite link
                <span className="block text-xs text-neutral-500">
                  {prospectEmail
                    ? `To send to ${prospectEmail} — they join as the operator.`
                    : "Share it with the client so they join as the operator."}
                </span>
              </span>
            </label>

            {error && <p className="text-xs text-red-600">{error}</p>}
            <Button onClick={handleBegin} disabled={isPending} className="w-full">
              {isPending ? "Starting…" : "Begin engagement"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            <p className="text-sm text-neutral-500">
              <span className="font-medium text-neutral-900">{title}</span> is live.
              {result.seededMilestones > 0 && (
                <>
                  {" "}
                  Seeded {result.seededMilestones}{" "}
                  {result.seededMilestones === 1 ? "milestone" : "milestones"} and{" "}
                  {result.seededTasks} {result.seededTasks === 1 ? "task" : "tasks"}.
                </>
              )}
            </p>
            {inviteUrl && (
              <div className="space-y-1.5">
                <p className="text-xs text-neutral-500">
                  Invite link — expires in 7 days{prospectEmail ? `, send it to ${prospectEmail}` : ""}:
                </p>
                <div className="flex gap-2">
                  <Input value={inviteUrl} readOnly className="font-mono text-xs" />
                  <Button variant="outline" onClick={handleCopy} className="shrink-0">
                    Copy
                  </Button>
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <Link href={`/b?engagement=${result.engagementId}`} className="flex-1">
                <Button className="w-full">Open task board</Button>
              </Link>
              <Link href={`/b/engagements/${result.engagementId}`} className="flex-1">
                <Button variant="outline" className="w-full">
                  Manage
                </Button>
              </Link>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
