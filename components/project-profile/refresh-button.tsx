"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { refreshProjectProfile } from "@/lib/actions/refresh-project-profile";

const REASON_MESSAGES: Record<string, string> = {
  not_authenticated: "You need to be signed in to refresh.",
  wrong_role: "Only builders can refresh the project profile.",
  no_repo: "No repository is selected.",
  fetch_failed: "Couldn't reach GitHub to fetch the latest repo state.",
  generation_failed: "The AI run failed. Try again in a moment.",
};

export function RefreshButton() {
  const [pending, startTransition] = useTransition();
  const [optimisticallySpinning, setOptimisticallySpinning] = useState(false);
  const busy = pending || optimisticallySpinning;

  const handleClick = () => {
    setOptimisticallySpinning(true);
    startTransition(async () => {
      try {
        const result = await refreshProjectProfile();
        if (result.ok) {
          toast.success("Project profile refreshed");
        } else {
          toast.error(REASON_MESSAGES[result.reason] ?? "Refresh failed");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        toast.error(`Refresh failed: ${msg}`);
      } finally {
        setOptimisticallySpinning(false);
      }
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:border-neutral-300 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-60"
      aria-label={busy ? "Refreshing project profile" : "Refresh project profile"}
    >
      <RefreshCw
        className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`}
        aria-hidden
      />
      {busy ? "Refreshing…" : "Refresh"}
    </button>
  );
}
