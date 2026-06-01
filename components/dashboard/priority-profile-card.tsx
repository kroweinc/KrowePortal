"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SlidersHorizontal, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { updatePriorityProfile } from "@/lib/actions/engagement";
import type { PriorityKey } from "@/lib/types";

const ALL: PriorityKey[] = ["quality", "speed", "cost", "security"];
const LABEL: Record<PriorityKey, string> = {
  quality: "Quality",
  speed: "Speed",
  cost: "Cost",
  security: "Security",
};

function normalize(profile: PriorityKey[]): PriorityKey[] {
  const seen = profile.filter((p) => ALL.includes(p));
  const missing = ALL.filter((p) => !seen.includes(p));
  return [...seen, ...missing];
}

export function PriorityProfileCard({
  engagementId,
  priorityProfile,
  canEdit,
}: {
  engagementId: string;
  priorityProfile: PriorityKey[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [order, setOrder] = useState<PriorityKey[]>(normalize(priorityProfile));

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  }

  function save() {
    startTransition(async () => {
      const result = await updatePriorityProfile(engagementId, order);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Priorities saved");
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <SlidersHorizontal className="h-4 w-4 text-neutral-500" />
        <h2 className="text-sm font-semibold text-neutral-900">Your priorities</h2>
      </div>
      <p className="mb-3 text-xs text-neutral-500">
        Rank what matters most for this project. This guides recommendations and how work gets done.
      </p>
      <ol className="space-y-1.5">
        {order.map((p, i) => (
          <li
            key={p}
            className="flex items-center justify-between rounded border border-neutral-150 bg-neutral-50 px-3 py-2"
          >
            <span className="text-sm text-neutral-800">
              <span className="mr-2 font-semibold text-neutral-400">{i + 1}</span>
              {LABEL[p]}
            </span>
            {canEdit && (
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0 || isPending}
                  className="text-neutral-400 hover:text-neutral-900 disabled:opacity-30"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === order.length - 1 || isPending}
                  className="text-neutral-400 hover:text-neutral-900 disabled:opacity-30"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </span>
            )}
          </li>
        ))}
      </ol>
      {canEdit && (
        <div className="mt-3 flex justify-end">
          <Button variant="outline" size="sm" onClick={save} disabled={isPending}>
            {isPending ? "Saving…" : "Save priorities"}
          </Button>
        </div>
      )}
    </div>
  );
}
