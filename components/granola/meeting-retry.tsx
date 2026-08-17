"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { refreshGranolaMeetingSnapshot } from "@/lib/actions/granola-meetings";
import type { GranolaTranscriptStatus } from "@/lib/types";

const OUTCOME_COPY: Record<GranolaTranscriptStatus, string> = {
  captured: "Got it — the call is here now.",
  plan_gated: "Granola still holds transcripts back on this plan.",
  not_ready: "Granola still hasn't finished this transcript.",
  failed: "Granola couldn't be reached. Try again in a moment.",
};

/**
 * "Try again" on a call whose snapshot failed or wasn't ready when it was
 * imported. The action fetches inline — this one is user-initiated, so blocking
 * is the honest UX, and the button says what it's doing while it waits.
 *
 * Always reports the outcome, never just re-renders. A retry that comes back
 * with the same status changes nothing on screen, and a button that appears to
 * do nothing reads as broken.
 */
export function MeetingRetry({
  importId,
  onRefreshed,
}: {
  importId: string;
  /** How the caller re-reads the call. Omit on a server-rendered page — the
      action revalidates it, so a router refresh is enough. */
  onRefreshed?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<string | null>(null);

  function retry() {
    setOutcome(null);
    startTransition(async () => {
      const result = await refreshGranolaMeetingSnapshot(importId);
      if (result.error) {
        setOutcome(result.error);
        return;
      }
      setOutcome(result.status ? OUTCOME_COPY[result.status] : null);
      if (onRefreshed) onRefreshed();
      else router.refresh();
    });
  }

  return (
    <p className="krowe-mtg-retry">
      <button type="button" className="krowe-mtg-retry-btn" onClick={retry} disabled={pending}>
        <RotateCcw size={13} strokeWidth={2} aria-hidden="true" />
        {pending ? "Checking Granola…" : "Try again"}
      </button>
      {outcome && (
        <span className="out" role="status">
          {outcome}
        </span>
      )}
    </p>
  );
}
