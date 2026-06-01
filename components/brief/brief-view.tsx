import type { BriefContent, BriefLineItem } from "@/lib/types";

function formatCurrency(amount: number): string {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function LineItemsTable({
  items,
  showHours = true,
  hourlyRate,
}: {
  items: BriefLineItem[];
  showHours?: boolean;
  hourlyRate?: number;
}) {
  if (items.length === 0) return null;
  const showRate = hourlyRate != null && showHours;
  // When a rate is shown, derive hour-based amounts from hours × rate so the
  // displayed math stays consistent (Hrs × Rate = Amount) even if a stored
  // amount is stale. Flat-fee items (no hours) keep their stored amount.
  const amountFor = (li: BriefLineItem) =>
    showRate && li.hours != null && !Number.isNaN(li.hours)
      ? Math.round(li.hours * hourlyRate!)
      : li.amount;
  const total = items.reduce((s, li) => s + amountFor(li), 0);
  return (
    <div className="space-y-2">
      {showRate && (
        <p className="text-xs text-neutral-500">
          Billed at a fixed rate of{" "}
          <span className="font-medium text-neutral-700">{formatCurrency(hourlyRate!)}/hr</span>.
        </p>
      )}
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-wide text-neutral-400">
          <tr>
            <th className="text-left font-medium py-1">Item</th>
            {showHours && <th className="text-right font-medium py-1 w-16">Hrs</th>}
            {showRate && <th className="text-right font-medium py-1 w-20">Rate</th>}
            <th className="text-right font-medium py-1 w-24">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i} className="border-t border-neutral-100">
              <td className="py-2 pr-2">
                <div className="text-neutral-900">{it.label || <span className="italic text-neutral-400">Unnamed</span>}</div>
                {it.notes && <div className="text-xs text-neutral-500 mt-0.5">{it.notes}</div>}
              </td>
              {showHours && <td className="py-2 text-right text-neutral-500">{it.hours ?? "—"}</td>}
              {showRate && (
                <td className="py-2 text-right text-neutral-500">
                  {it.hours != null ? `${formatCurrency(hourlyRate!)}/hr` : "—"}
                </td>
              )}
              <td className="py-2 text-right text-neutral-900">{formatCurrency(amountFor(it))}</td>
            </tr>
          ))}
          <tr className="border-t border-neutral-200 font-semibold">
            <td className="py-2 text-neutral-500 uppercase text-xs">Subtotal</td>
            {showHours && <td />}
            {showRate && <td />}
            <td className="py-2 text-right">{formatCurrency(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</h3>
      {children}
    </section>
  );
}

export function BriefView({ content }: { content: BriefContent }) {
  const showHours = true;
  const preWork = content.preWork ?? [];
  const projectItems = content.projectLineItems ?? [];
  const deliverables = content.deliverables ?? [];
  const outOfScope = content.outOfScope ?? [];
  const assumptions = content.assumptions ?? [];

  const preWorkTotal = preWork.reduce((s, li) => s + li.amount, 0);
  const projectTotal = projectItems.reduce((s, li) => s + li.amount, 0);
  const grandTotal = preWorkTotal + projectTotal;

  return (
    <div className="space-y-7">
      {content.summary && (
        <Section title="Summary">
          <p className="text-sm leading-relaxed text-neutral-800 whitespace-pre-wrap">{content.summary}</p>
        </Section>
      )}

      {content.proposedSolution && (
        <Section title="Proposed Solution">
          <p className="text-sm leading-relaxed text-neutral-800 whitespace-pre-wrap">{content.proposedSolution}</p>
        </Section>
      )}

      {deliverables.length > 0 && (
        <Section title="Deliverables">
          <ul className="space-y-2.5">
            {deliverables.map((d, i) => (
              <li key={i} className="text-sm">
                <div className="font-medium text-neutral-900">{d.title}</div>
                {d.acceptanceCriteria && (
                  <div className="text-xs text-neutral-500 mt-0.5">
                    <span className="uppercase tracking-wide text-neutral-400">Accepted when:</span>{" "}
                    {d.acceptanceCriteria}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {preWork.length > 0 && (
        <Section title="Pre-Work / Onboarding">
          <LineItemsTable items={preWork} showHours={showHours} hourlyRate={content.hourlyRate ?? 175} />
        </Section>
      )}

      {projectItems.length > 0 && (
        <Section title="Project Line Items">
          <LineItemsTable items={projectItems} showHours={showHours} />
        </Section>
      )}

      {(preWork.length > 0 || projectItems.length > 0) && (
        <div className="flex items-center justify-between rounded-lg bg-neutral-50 px-4 py-3">
          <span className="text-xs uppercase tracking-wide text-neutral-500">Grand total</span>
          <span className="text-lg font-semibold text-neutral-900">{formatCurrency(grandTotal)}</span>
        </div>
      )}

      {content.timeline && (
        <Section title="Timeline">
          <p className="text-sm leading-relaxed text-neutral-800 whitespace-pre-wrap">{content.timeline}</p>
        </Section>
      )}

      {content.paymentTerms && (
        <Section title="Payment Terms">
          <p className="text-sm text-neutral-800">{content.paymentTerms}</p>
        </Section>
      )}

      {outOfScope.length > 0 && (
        <Section title="Out of Scope">
          <ul className="list-disc pl-5 space-y-1 text-sm text-neutral-800">
            {outOfScope.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </Section>
      )}

      {assumptions.length > 0 && (
        <Section title="Assumptions">
          <ul className="list-disc pl-5 space-y-1 text-sm text-neutral-800">
            {assumptions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </Section>
      )}

      {content.validityDays != null && (
        <p className="text-xs text-neutral-400 italic">
          This brief is valid for {content.validityDays} days from the date it was sent.
        </p>
      )}
    </div>
  );
}
