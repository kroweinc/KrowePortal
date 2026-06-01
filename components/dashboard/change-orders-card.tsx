"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GitPullRequest, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signChangeOrder, rejectChangeOrder } from "@/lib/actions/change-orders";
import type { ChangeOrder } from "@/lib/types";

function fmt(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function ChangeOrdersCard({
  changeOrders,
  canSign,
}: {
  changeOrders: ChangeOrder[];
  canSign: boolean;
}) {
  // Don't surface drafts to the operator; builder sees those on their side.
  const visible = canSign
    ? changeOrders.filter((c) => c.status !== "draft")
    : changeOrders;
  if (visible.length === 0) return null;

  const signedTotal = changeOrders
    .filter((c) => c.status === "signed")
    .reduce((s, c) => s + (c.delta_amount ?? 0), 0);

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <GitPullRequest className="h-4 w-4 text-neutral-500" />
          <h2 className="text-sm font-semibold text-neutral-900">Change orders</h2>
        </div>
        {signedTotal !== 0 && (
          <span className="text-xs text-neutral-500">
            Added scope: <span className="font-medium text-neutral-800">{fmt(signedTotal)}</span>
          </span>
        )}
      </div>

      <ul className="space-y-3">
        {visible.map((co) => (
          <ChangeOrderRow key={co.id} co={co} canSign={canSign} />
        ))}
      </ul>
    </div>
  );
}

function ChangeOrderRow({ co, canSign }: { co: ChangeOrder; canSign: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [signing, setSigning] = useState(false);
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);

  function sign() {
    if (name.trim().length < 2) return toast.error("Type your name to sign.");
    if (!consent) return toast.error("Agree to the terms to sign.");
    startTransition(async () => {
      const result = await signChangeOrder(co.id, { signerName: name, consent });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Change order signed");
      router.refresh();
    });
  }

  function reject() {
    const note = window.prompt("Optional note for your builder:") ?? null;
    startTransition(async () => {
      const result = await rejectChangeOrder(co.id, note);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Change order rejected");
      router.refresh();
    });
  }

  const items = co.content.lineItems ?? [];

  return (
    <li className="border-b border-neutral-100 pb-3 last:border-0 last:pb-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-neutral-900">{co.title}</span>
        <span className="shrink-0 text-sm text-neutral-700">{fmt(co.delta_amount ?? co.content.total ?? 0)}</span>
      </div>
      {co.content.summary && <p className="mt-0.5 text-xs text-neutral-600">{co.content.summary}</p>}
      {items.length > 0 && (
        <ul className="mt-1 list-disc pl-4 text-xs text-neutral-500">
          {items.map((li, i) => (
            <li key={i}>{li.label}{li.amount ? ` — ${fmt(li.amount)}` : ""}</li>
          ))}
        </ul>
      )}

      {co.status === "signed" && (
        <p className="mt-1 text-xs text-emerald-700">
          Signed{co.signed_by_name ? ` by ${co.signed_by_name}` : ""}{co.signed_at ? ` · ${formatDate(co.signed_at)}` : ""}
        </p>
      )}
      {co.status === "rejected" && (
        <p className="mt-1 text-xs text-neutral-400">
          Rejected{co.rejection_note ? `: ${co.rejection_note}` : ""}
        </p>
      )}

      {canSign && co.status === "sent" && (
        <div className="mt-2">
          {!signing ? (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setSigning(true)} disabled={isPending}>
                <PenLine className="h-3.5 w-3.5" /> Review &amp; sign
              </Button>
              <Button variant="ghost" size="sm" onClick={reject} disabled={isPending}>
                Reject
              </Button>
            </div>
          ) : (
            <div className="space-y-2 rounded-md border border-neutral-200 bg-neutral-50 p-2">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Type your name to sign"
                className="w-full rounded border border-neutral-200 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
              />
              <label className="flex items-start gap-2 text-xs text-neutral-600">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
                I approve this change order and consent to sign electronically.
              </label>
              <div className="flex justify-end">
                <Button size="sm" onClick={sign} disabled={isPending}>
                  {isPending ? "Signing…" : "Sign change order"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
