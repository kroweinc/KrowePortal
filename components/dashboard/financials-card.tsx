import { Wallet } from "lucide-react";
import type { Brief, EngagementAgreement, InfraRecommendation } from "@/lib/types";
import type { MilestoneWithProgress } from "@/lib/actions/milestones";

function fmt(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function effectiveMonthly(rec: InfraRecommendation): number {
  if (rec.accepted && rec.operator_override_monthly != null) return rec.operator_override_monthly;
  return rec.recommended_monthly ?? 0;
}

export function FinancialsCard({
  signedQuote,
  milestones,
  agreement,
  infra,
}: {
  signedQuote: Brief | null;
  milestones: MilestoneWithProgress[];
  agreement: EngagementAgreement | null;
  infra: InfraRecommendation[];
}) {
  const grand = signedQuote?.content.totals?.grand ?? 0;
  const preWork = signedQuote?.content.totals?.preWork ?? 0;
  const project = signedQuote?.content.totals?.project ?? 0;
  const rate = signedQuote?.content.hourlyRate ?? 175;

  // "Delivered value" = sum of source_amount on done milestones (proxy for spend).
  const delivered = milestones
    .filter((m) => m.status === "done")
    .reduce((s, m) => s + (m.source_amount ?? 0), 0);
  const remaining = Math.max(0, grand - delivered);

  const infraMonthly = infra.reduce((s, r) => s + effectiveMonthly(r), 0);
  const monthly = (agreement?.monthly_recurring ?? 0) + infraMonthly;
  const surchargeMult = agreement?.urgency_multiplier ?? 1.5;
  const pct = grand > 0 ? Math.round((delivered / grand) * 100) : 0;

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Wallet className="h-4 w-4 text-neutral-500" />
        <h2 className="text-sm font-semibold text-neutral-900">Money</h2>
      </div>

      {/* Project budget */}
      <div className="mb-4">
        <div className="mb-1 flex items-center justify-between text-sm">
          <span className="text-neutral-500">Project budget</span>
          <span className="font-medium text-neutral-900">{fmt(grand)}</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
          <div className={`h-full rounded-full ${remaining === 0 && grand > 0 ? "bg-emerald-500" : "bg-neutral-900"}`} style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1 flex justify-between text-xs text-neutral-500">
          <span>{fmt(delivered)} delivered</span>
          <span>{fmt(remaining)} remaining</span>
        </div>
      </div>

      {/* Breakdown */}
      <div className="mb-4 space-y-1 border-t border-neutral-100 pt-3 text-sm">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">Breakdown</div>
        <Row label="Onboarding / pre-work" value={fmt(preWork)} />
        <Row label="Build labor" value={fmt(project)} />
        {monthly > 0 && <Row label="Projected monthly (hosting + tools)" value={`${fmt(monthly)}/mo`} />}
      </div>

      {signedQuote?.content.paymentTerms && (
        <p className="mb-3 text-xs text-neutral-500">{signedQuote.content.paymentTerms}</p>
      )}

      <div className="flex items-center justify-between border-t border-neutral-100 pt-3 text-xs text-neutral-500">
        <span>Billing: {agreement?.billing_mode === "hourly" ? "Hourly" : "Fixed contract"}</span>
        <span>Urgent tasks: {surchargeMult}× ({fmt(Math.round(rate * surchargeMult))}/hr)</span>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-neutral-600">{label}</span>
      <span className="text-neutral-900">{value}</span>
    </div>
  );
}
