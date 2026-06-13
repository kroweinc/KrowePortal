/* Polished editorial read-only renderer for a quote — the exact document the
   recipient receives. Reproduces the reference "Product Quote Breakdown" layout:
   total banner → scope summary → product-level cost table → per-module sections →
   design-system inclusion table → payment structure → justification → scope
   protection → footer note. Used by the public client page and the print/PDF.
   Reuses prd-document.css (.doc-* / .prd-doc-stage) plus quote.css for tables. */

import type { ReactNode } from "react";
import type { QuoteContent } from "@/lib/types";
import { formatUSD } from "@/lib/quote/format";
import "@/components/prd/prd-document.css";
import "./quote.css";

function DocSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="doc-section">
      <h3 className="doc-section__title">{title}</h3>
      {children}
    </section>
  );
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

/** Compact hours display: whole when integer, else one decimal. */
function fmtHours(h: number): string {
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
}

const EXTRA_KIND_LABELS: Record<string, string> = {
  design: "Design system",
  addon: "Add-on",
  fee: "Fee",
  discount: "Discount",
};

export function QuoteDocument({ content: c }: { content: QuoteContent }) {
  const modules = c.modules ?? [];
  const extras = (c.extraCosts ?? []).filter((e) => e.label || e.amount || e.percent);
  const designSystem = c.designSystem ?? [];
  const payments = c.paymentMilestones ?? [];
  const justification = c.justification ?? [];
  const scopeProtection = c.scopeProtection ?? [];
  const grand = c.totals?.grand ?? 0;
  const modulesTotal = c.totals?.modulesTotal ?? 0;
  const paymentTotal = c.totals?.paymentTotal ?? 0;
  const showHours = !!c.showHours;

  return (
    <div className="doc-body quote-doc">
      {/* Total banner */}
      <div className="quote-doc__banner">
        <span className="quote-doc__banner-label">Total Project Quote</span>
        <span className="quote-doc__banner-value">{formatUSD(grand)}</span>
      </div>

      {c.scopeSummary && (
        <DocSection title="Scope Summary">
          <p className="doc-prose">{c.scopeSummary}</p>
        </DocSection>
      )}

      {/* §1 Product-level cost breakdown (build modules + any add-ons / fees) */}
      {(modules.length > 0 || extras.length > 0) && (
        <DocSection title="Cost Overview">
          <table className="quote-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Purpose</th>
                <th className="quote-table__num">Cost</th>
              </tr>
            </thead>
            <tbody>
              {modules.map((m, i) => (
                <tr key={`m${i}`}>
                  <td className="quote-table__name">{m.title}</td>
                  <td className="quote-table__muted">{m.purpose}</td>
                  <td className="quote-table__num">{formatUSD(m.cost)}</td>
                </tr>
              ))}
              {extras.length > 0 && modules.length > 0 && (
                <tr className="quote-table__sub">
                  <td className="quote-table__name">Build subtotal</td>
                  <td />
                  <td className="quote-table__num">{formatUSD(modulesTotal)}</td>
                </tr>
              )}
              {extras.map((e, i) => {
                const isDiscount = e.kind === "discount";
                const type =
                  e.percent != null
                    ? `${EXTRA_KIND_LABELS[e.kind] ?? "Add-on"} · ${e.percent}% of build`
                    : EXTRA_KIND_LABELS[e.kind] ?? "Add-on";
                return (
                  <tr key={`x${i}`}>
                    <td className="quote-table__name">{e.label}</td>
                    <td className="quote-table__muted">{type}</td>
                    <td className="quote-table__num">{formatUSD(isDiscount ? -e.amount : e.amount)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td />
                <td className="quote-table__num">{formatUSD(grand)}</td>
              </tr>
            </tfoot>
          </table>
        </DocSection>
      )}

      {/* §2..N per-module detail */}
      {modules.map((m, i) => (
        <DocSection key={i} title={`${m.title} — ${formatUSD(m.cost)}`}>
          {m.description && <p className="doc-prose">{m.description}</p>}
          {(m.lineItems ?? []).length > 0 && (
            <table className="quote-table">
              <thead>
                <tr>
                  <th>Item</th>
                  {showHours && <th className="quote-table__num">Hours</th>}
                  <th className="quote-table__num">Cost</th>
                </tr>
              </thead>
              <tbody>
                {m.lineItems!.map((li, j) => (
                  <tr key={j}>
                    <td className="quote-table__name">
                      {li.label}
                      {li.notes && <span className="quote-table__notes"> — {li.notes}</span>}
                    </td>
                    {showHours && (
                      <td className="quote-table__num">{li.hours != null ? `${fmtHours(li.hours)}h` : "—"}</td>
                    )}
                    <td className="quote-table__num">{formatUSD(li.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Subtotal</td>
                  {showHours && (
                    <td className="quote-table__num">
                      {fmtHours((m.lineItems ?? []).reduce((s, li) => s + (Number(li.hours) || 0), 0))}h
                    </td>
                  )}
                  <td className="quote-table__num">{formatUSD(m.cost)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </DocSection>
      ))}

      {/* Design system inclusion */}
      {designSystem.length > 0 && (
        <DocSection title="Design System Included">
          <table className="quote-table">
            <thead>
              <tr>
                <th>Component</th>
                <th className="quote-table__num">Included</th>
              </tr>
            </thead>
            <tbody>
              {designSystem.map((d, i) => (
                <tr key={i}>
                  <td className="quote-table__name">{d.component}</td>
                  <td className="quote-table__num">{d.included ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DocSection>
      )}

      {/* Payment structure */}
      {payments.length > 0 && (
        <DocSection title="Suggested Payment Structure">
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
                  <td className="quote-table__name">{p.label}</td>
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

      {justification.length > 0 && (
        <DocSection title="Why This Price Is Justified">
          <Bullets items={justification} />
        </DocSection>
      )}

      {scopeProtection.length > 0 && (
        <DocSection title="Scope Protection">
          <p className="doc-prose quote-doc__protect-lead">Not included in this quote unless separately quoted:</p>
          <Bullets items={scopeProtection} />
        </DocSection>
      )}

      {c.footerNote && <p className="quote-doc__footer">{c.footerNote}</p>}
    </div>
  );
}
