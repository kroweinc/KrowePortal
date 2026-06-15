/* Polished editorial read-only renderer for a contract — the exact services
   agreement the client receives and e-signs. Mirrors quote-document.tsx: a
   prose body with two snapshotted exhibits (Scope of Work + Payment Schedule)
   rendered as tables. Used by the public client page, the dashboard preview,
   and the print/PDF. Reuses prd-document.css (.doc-*) + quote.css (.quote-table). */

import type { ReactNode } from "react";
import type { ContractContent } from "@/lib/types";
import { formatUSD } from "@/lib/quote/format";
import { formatEffectiveDate } from "@/lib/contract/effective-date";
import "@/components/prd/prd-document.css";
import "@/components/quote/quote.css";

function DocSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="doc-section">
      <h3 className="doc-section__title">{title}</h3>
      {children}
    </section>
  );
}

function Para({ text }: { text: string }) {
  return <p className="doc-prose" style={{ whiteSpace: "pre-wrap" }}>{text}</p>;
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="doc-bullets">
      {items.map((s, i) => (
        <li key={i}>{s}</li>
      ))}
    </ul>
  );
}

// Long-form clauses, in document order. Rendered only when non-empty.
const PROSE_SECTIONS: { key: keyof ContractContent; title: string }[] = [
  { key: "paymentTerms", title: "Payment Terms" },
  { key: "timeline", title: "Timeline" },
  { key: "ipOwnership", title: "Intellectual Property" },
  { key: "confidentiality", title: "Confidentiality" },
  { key: "warranties", title: "Warranties" },
  { key: "liability", title: "Limitation of Liability" },
  { key: "termination", title: "Termination" },
  { key: "changeManagement", title: "Change Management" },
  { key: "governingLaw", title: "Governing Law" },
];

// `effectiveDate` is injected by the caller (which knows the contract's status):
// today's date while it's a draft, the frozen date once it's been sent. Falls
// back to whatever is stored on the content for any caller that doesn't pass it.
export function ContractDocument({
  content: c,
  effectiveDate,
}: {
  content: ContractContent;
  effectiveDate?: string | null;
}) {
  const parties = c.parties;
  const shownEffectiveDate = effectiveDate !== undefined ? effectiveDate : c.effectiveDate ?? null;
  const deliverables = c.deliverables ?? [];
  const scopeItems = (c.scopeItems ?? []).filter((s) => s.title);
  const payments = (c.paymentSchedule ?? []).filter((p) => p.label || p.amount);
  const additionalTerms = c.additionalTerms ?? [];
  const paymentTotal =
    typeof c.quoteTotal === "number"
      ? c.quoteTotal
      : payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

  return (
    <div className="doc-body">
      {(parties?.provider || parties?.client || shownEffectiveDate) && (
        <DocSection title="Parties">
          <div className="doc-prose">
            {parties?.provider && (
              <div>
                <span className="doc-muted">Provider:</span> {parties.provider}
              </div>
            )}
            {parties?.client && (
              <div>
                <span className="doc-muted">Client:</span> {parties.client}
              </div>
            )}
            {shownEffectiveDate && (
              <div>
                <span className="doc-muted">Effective date:</span> {formatEffectiveDate(shownEffectiveDate)}
              </div>
            )}
          </div>
        </DocSection>
      )}

      {c.scopeOfServices && (
        <DocSection title="Scope of Services">
          <Para text={c.scopeOfServices} />
        </DocSection>
      )}

      {deliverables.length > 0 && (
        <DocSection title="Deliverables">
          <Bullets items={deliverables} />
        </DocSection>
      )}

      {/* Exhibit A — Scope of Work (snapshotted from the quote breakdown) */}
      {scopeItems.length > 0 && (
        <DocSection title="Exhibit A — Scope of Work">
          <table className="quote-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Purpose</th>
                <th className="quote-table__num">Cost</th>
              </tr>
            </thead>
            <tbody>
              {scopeItems.map((s, i) => (
                <tr key={i}>
                  <td className="quote-table__name">{s.title}</td>
                  <td className="quote-table__muted">{s.purpose}</td>
                  <td className="quote-table__num">{s.cost != null ? formatUSD(s.cost) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DocSection>
      )}

      {c.fees && (
        <DocSection title="Fees">
          <Para text={c.fees} />
        </DocSection>
      )}

      {/* Exhibit B — Payment Schedule (snapshotted from the quote milestones) */}
      {payments.length > 0 && (
        <DocSection title="Exhibit B — Payment Schedule">
          <table className="quote-table">
            <thead>
              <tr>
                <th>Milestone</th>
                <th className="quote-table__num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p, i) => (
                <tr key={i}>
                  <td className="quote-table__name">
                    {p.label}
                    {p.percent != null && <span className="quote-table__notes"> — {p.percent}%</span>}
                  </td>
                  <td className="quote-table__num">{formatUSD(p.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="quote-table__num">{formatUSD(paymentTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </DocSection>
      )}

      {PROSE_SECTIONS.map((s) => {
        const text = c[s.key] as string | undefined;
        return text ? (
          <DocSection key={s.key as string} title={s.title}>
            <Para text={text} />
          </DocSection>
        ) : null;
      })}

      {additionalTerms.length > 0 && (
        <DocSection title="Additional Terms">
          <Bullets items={additionalTerms} />
        </DocSection>
      )}
    </div>
  );
}
