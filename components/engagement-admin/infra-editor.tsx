"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addInfraRecommendation, deleteInfraRecommendation } from "@/lib/actions/engagement";
import type { InfraRecommendation } from "@/lib/types";

function fmt(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function InfraEditor({
  engagementId,
  recommendations,
}: {
  engagementId: string;
  recommendations: InfraRecommendation[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [category, setCategory] = useState("");
  const [item, setItem] = useState("");
  const [monthly, setMonthly] = useState("");

  function add() {
    if (item.trim().length === 0) return toast.error("Name the service.");
    startTransition(async () => {
      const result = await addInfraRecommendation(engagementId, {
        category: category.trim() || null,
        item: item.trim(),
        recommendedMonthly: monthly.trim() ? Number(monthly) : null,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setCategory("");
      setItem("");
      setMonthly("");
      toast.success("Added");
      router.refresh();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const result = await deleteInfraRecommendation(id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-1.5">
        {recommendations.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="text-neutral-800">
              {r.category && <span className="mr-2 text-xs uppercase text-neutral-400">{r.category}</span>}
              {r.item}
              {r.operator_override && <span className="ml-1 text-xs text-amber-600">→ {r.operator_override}</span>}
            </span>
            <span className="flex items-center gap-2 text-neutral-500">
              {fmt(r.recommended_monthly)}/mo
              <button type="button" onClick={() => remove(r.id)} disabled={isPending} className="text-neutral-300 hover:text-neutral-700">
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          </li>
        ))}
      </ul>
      <div className="flex gap-1.5">
        <input type="text" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category" className="w-28 rounded border border-neutral-200 px-2 py-1.5 text-sm" />
        <input type="text" value={item} onChange={(e) => setItem(e.target.value)} placeholder="Service (e.g. Vercel Pro)" className="flex-1 rounded border border-neutral-200 px-2 py-1.5 text-sm" />
        <input type="number" value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="$/mo" className="w-24 rounded border border-neutral-200 px-2 py-1.5 text-sm" />
        <Button variant="outline" size="sm" onClick={add} disabled={isPending}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
