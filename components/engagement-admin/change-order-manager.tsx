"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, X, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createChangeOrder, sendChangeOrder } from "@/lib/actions/change-orders";
import type { ChangeOrder } from "@/lib/types";

function fmt(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

interface DraftItem {
  label: string;
  hours: string;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  signed: "Signed",
  rejected: "Rejected",
};

export function ChangeOrderManager({
  engagementId,
  changeOrders,
}: {
  engagementId: string;
  changeOrders: ChangeOrder[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [rate, setRate] = useState("200");
  const [items, setItems] = useState<DraftItem[]>([{ label: "", hours: "" }]);

  const total = items.reduce((s, it) => s + Math.round((Number(it.hours) || 0) * (Number(rate) || 0)), 0);

  function create() {
    if (title.trim().length === 0) return toast.error("Give the change order a title.");
    const lineItems = items
      .filter((it) => it.label.trim())
      .map((it) => {
        const hours = Number(it.hours) || 0;
        return { label: it.label.trim(), hours, amount: Math.round(hours * (Number(rate) || 0)), notes: null };
      });
    startTransition(async () => {
      const result = await createChangeOrder(engagementId, {
        title: title.trim(),
        content: { summary: summary.trim() || undefined, lineItems, hourlyRate: Number(rate) || 200 },
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setCreating(false);
      setTitle("");
      setSummary("");
      setItems([{ label: "", hours: "" }]);
      toast.success("Change order drafted");
      router.refresh();
    });
  }

  function send(id: string) {
    if (!confirm("Send this change order to the operator to sign?")) return;
    startTransition(async () => {
      const result = await sendChangeOrder(id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Sent");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {changeOrders.map((co) => (
          <li key={co.id} className="flex items-center justify-between gap-2 rounded border border-neutral-150 px-3 py-2 text-sm">
            <div>
              <span className="font-medium text-neutral-900">{co.title}</span>
              <span className="ml-2 text-xs text-neutral-400">{STATUS_LABEL[co.status] ?? co.status}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-neutral-700">{fmt(co.delta_amount ?? co.content.total ?? 0)}</span>
              {co.status === "draft" && (
                <Button size="sm" variant="outline" onClick={() => send(co.id)} disabled={isPending}>
                  <Send className="h-3.5 w-3.5" /> Send
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {!creating ? (
        <Button variant="ghost" size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-3.5 w-3.5" /> New change order
        </Button>
      ) : (
        <div className="space-y-2 rounded-md border border-neutral-200 bg-neutral-50 p-3">
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Change order title" className={inputCls} />
          <textarea rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What's changing and why…" className={inputCls} />
          <div className="flex items-center gap-2 text-sm">
            <span className="text-neutral-500">Rate $/hr</span>
            <input type="number" value={rate} onChange={(e) => setRate(e.target.value)} className="w-24 rounded border border-neutral-200 px-2 py-1 text-sm" />
          </div>
          <div className="space-y-1.5">
            {items.map((it, i) => (
              <div key={i} className="flex gap-1.5">
                <input type="text" value={it.label} onChange={(e) => setItems(items.map((x, idx) => (idx === i ? { ...x, label: e.target.value } : x)))} placeholder="Work item" className="flex-1 rounded border border-neutral-200 px-2 py-1 text-sm" />
                <input type="number" value={it.hours} onChange={(e) => setItems(items.map((x, idx) => (idx === i ? { ...x, hours: e.target.value } : x)))} placeholder="hrs" className="w-20 rounded border border-neutral-200 px-2 py-1 text-sm" />
                <button type="button" onClick={() => setItems(items.filter((_, idx) => idx !== i))} className="px-1 text-neutral-300 hover:text-neutral-700">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => setItems([...items, { label: "", hours: "" }])} className="text-xs text-neutral-500 hover:text-neutral-900">
              <Plus className="inline h-3 w-3" /> Add item
            </button>
          </div>
          <div className="flex items-center justify-between border-t border-neutral-200 pt-2">
            <span className="text-sm font-medium text-neutral-900">Total: {fmt(total)}</span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setCreating(false)} disabled={isPending}>Cancel</Button>
              <Button size="sm" onClick={create} disabled={isPending}>{isPending ? "Saving…" : "Save draft"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls = "w-full rounded border border-neutral-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400";
