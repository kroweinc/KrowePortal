"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { updateOperatingAgreement } from "@/lib/actions/engagement";
import type { EngagementAgreement, DecisionRight, CommChannel, BillingMode } from "@/lib/types";

export function AgreementEditor({
  engagementId,
  agreement,
}: {
  engagementId: string;
  agreement: EngagementAgreement | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [warrantyDays, setWarrantyDays] = useState<string>(String(agreement?.warranty_days ?? 30));
  const [reviewCadence, setReviewCadence] = useState(agreement?.review_cadence ?? "");
  const [meetingSchedule, setMeetingSchedule] = useState(agreement?.meeting_schedule ?? "");
  const [billingMode, setBillingMode] = useState<BillingMode>(agreement?.billing_mode ?? "fixed");
  const [monthlyRecurring, setMonthlyRecurring] = useState<string>(
    agreement?.monthly_recurring != null ? String(agreement.monthly_recurring) : ""
  );
  const [urgency, setUrgency] = useState<string>(String(agreement?.urgency_multiplier ?? 1.5));
  const [rights, setRights] = useState<DecisionRight[]>(agreement?.decision_rights ?? []);
  const [channels, setChannels] = useState<CommChannel[]>(agreement?.comm_channels ?? []);

  function save() {
    startTransition(async () => {
      const result = await updateOperatingAgreement(engagementId, {
        warrantyDays: Number(warrantyDays) || 30,
        decisionRights: rights.filter((r) => r.decision.trim()),
        reviewCadence: reviewCadence.trim() || null,
        meetingSchedule: meetingSchedule.trim() || null,
        commChannels: channels.filter((c) => c.channel.trim()),
        billingMode,
        monthlyRecurring: monthlyRecurring.trim() ? Number(monthlyRecurring) : null,
        urgencyMultiplier: Number(urgency) || 1.5,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Agreement saved");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Labeled label="Warranty (days)">
          <input type="number" value={warrantyDays} onChange={(e) => setWarrantyDays(e.target.value)} className={inputCls} />
        </Labeled>
        <Labeled label="Billing mode">
          <select value={billingMode} onChange={(e) => setBillingMode(e.target.value as BillingMode)} className={inputCls}>
            <option value="fixed">Fixed contract</option>
            <option value="hourly">Hourly</option>
          </select>
        </Labeled>
        <Labeled label="Urgency ×">
          <input type="number" step="0.1" value={urgency} onChange={(e) => setUrgency(e.target.value)} className={inputCls} />
        </Labeled>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Labeled label="Meeting schedule">
          <input type="text" value={meetingSchedule} onChange={(e) => setMeetingSchedule(e.target.value)} placeholder="e.g. Weekly Tue 10am" className={inputCls} />
        </Labeled>
        <Labeled label="Review cadence / SLA">
          <input type="text" value={reviewCadence} onChange={(e) => setReviewCadence(e.target.value)} placeholder="e.g. Approve within 2 business days" className={inputCls} />
        </Labeled>
      </div>

      <Labeled label="Projected monthly recurring ($/mo)">
        <input type="number" value={monthlyRecurring} onChange={(e) => setMonthlyRecurring(e.target.value)} placeholder="hosting + licenses + retainer" className={inputCls} />
      </Labeled>

      {/* Decision rights */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Decision rights</span>
          <button type="button" onClick={() => setRights([...rights, { decision: "", signer: "", reviewer: "", informed: "" }])} className="text-xs text-neutral-500 hover:text-neutral-900">
            <Plus className="inline h-3 w-3" /> Add row
          </button>
        </div>
        <div className="space-y-2">
          {rights.map((r, i) => (
            <div key={i} className="flex gap-1.5">
              {(["decision", "signer", "reviewer", "informed"] as (keyof DecisionRight)[]).map((f) => (
                <input
                  key={f}
                  type="text"
                  value={r[f]}
                  onChange={(e) => setRights(rights.map((x, idx) => (idx === i ? { ...x, [f]: e.target.value } : x)))}
                  placeholder={f}
                  className={inputCls}
                />
              ))}
              <button type="button" onClick={() => setRights(rights.filter((_, idx) => idx !== i))} className="px-1 text-neutral-300 hover:text-neutral-700">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Channels */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Communication channels</span>
          <button type="button" onClick={() => setChannels([...channels, { channel: "", purpose: "" }])} className="text-xs text-neutral-500 hover:text-neutral-900">
            <Plus className="inline h-3 w-3" /> Add channel
          </button>
        </div>
        <div className="space-y-2">
          {channels.map((c, i) => (
            <div key={i} className="flex gap-1.5">
              <input type="text" value={c.channel} onChange={(e) => setChannels(channels.map((x, idx) => (idx === i ? { ...x, channel: e.target.value } : x)))} placeholder="e.g. In-portal chat" className={inputCls} />
              <input type="text" value={c.purpose} onChange={(e) => setChannels(channels.map((x, idx) => (idx === i ? { ...x, purpose: e.target.value } : x)))} placeholder="what goes here" className={inputCls} />
              <button type="button" onClick={() => setChannels(channels.filter((_, idx) => idx !== i))} className="px-1 text-neutral-300 hover:text-neutral-700">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={save} disabled={isPending}>
          {isPending ? "Saving…" : "Save agreement"}
        </Button>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded border border-neutral-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400";

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-700">{label}</span>
      {children}
    </label>
  );
}
