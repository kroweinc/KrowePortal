"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Server, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setInfraOverride } from "@/lib/actions/engagement";
import type { InfraRecommendation } from "@/lib/types";

function fmt(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function InfraCard({
  recommendations,
  canOverride,
}: {
  recommendations: InfraRecommendation[];
  canOverride: boolean;
}) {
  if (recommendations.length === 0) return null;

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Server className="h-4 w-4 text-neutral-500" />
        <h2 className="text-sm font-semibold text-neutral-900">Infrastructure</h2>
      </div>
      <ul className="space-y-3">
        {recommendations.map((r) => (
          <InfraRow key={r.id} rec={r} canOverride={canOverride} />
        ))}
      </ul>
    </div>
  );
}

function InfraRow({ rec, canOverride }: { rec: InfraRecommendation; canOverride: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [override, setOverride] = useState(rec.operator_override ?? "");
  const [overrideMonthly, setOverrideMonthly] = useState<string>(
    rec.operator_override_monthly != null ? String(rec.operator_override_monthly) : ""
  );

  function save(accepted: boolean) {
    startTransition(async () => {
      const result = await setInfraOverride(rec.id, {
        override: override.trim() || null,
        overrideMonthly: overrideMonthly.trim() ? Number(overrideMonthly) : null,
        accepted,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setEditing(false);
      toast.success("Updated");
      router.refresh();
    });
  }

  const usingOverride = rec.accepted && rec.operator_override;

  return (
    <li className="border-b border-neutral-100 pb-3 last:border-0 last:pb-0">
      <div className="flex items-center justify-between gap-2">
        <div>
          {rec.category && <div className="text-xs uppercase tracking-wide text-neutral-400">{rec.category}</div>}
          <div className="text-sm text-neutral-800">
            {usingOverride ? (
              <>
                <span className="font-medium">{rec.operator_override}</span>{" "}
                <span className="text-xs text-neutral-400">(was {rec.item})</span>
              </>
            ) : (
              <span className="font-medium">{rec.item}</span>
            )}
          </div>
        </div>
        <div className="text-right text-sm text-neutral-700">
          {usingOverride ? fmt(rec.operator_override_monthly) : fmt(rec.recommended_monthly)}
          <span className="text-xs text-neutral-400">/mo</span>
        </div>
      </div>

      {canOverride && (
        <div className="mt-1.5">
          {!editing ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs text-neutral-400 underline hover:text-neutral-700"
            >
              {usingOverride ? "Change choice" : "Swap for an alternative"}
            </button>
          ) : (
            <div className="space-y-2 rounded-md border border-neutral-200 bg-neutral-50 p-2">
              <input
                type="text"
                value={override}
                onChange={(e) => setOverride(e.target.value)}
                placeholder="Alternative service name"
                className="w-full rounded border border-neutral-200 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
              />
              <input
                type="number"
                value={overrideMonthly}
                onChange={(e) => setOverrideMonthly(e.target.value)}
                placeholder="$/mo"
                className="w-full rounded border border-neutral-200 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => save(false)} disabled={isPending}>
                  Use builder&apos;s pick
                </Button>
                <Button size="sm" onClick={() => save(true)} disabled={isPending}>
                  <Check className="h-3.5 w-3.5" /> Use mine
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
