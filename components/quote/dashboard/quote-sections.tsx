"use client";

/* Quote section renderers. Each section's Body uses the inline primitives (shared
   with the PRD dashboard), so the same component serves read + edit. The SECTIONS
   registry drives the rail TOC and content order. Mirrors prd-sections.tsx. */

import { type ComponentType, type ReactNode } from "react";
import type { QuoteContent, QuoteModule, BriefLineItem, QuotePaymentMilestone, QuoteDesignComponent } from "@/lib/types";
import { InlineText, InlineList, AddButton, RemoveCard, useEditing } from "@/components/prd/dashboard/inline-edit";
import { MoneyInput } from "./money-input";
import { QuoteCostOverview } from "./quote-cost-overview";
import { formatUSD } from "@/lib/quote/format";
import { DEFAULT_QUOTE_HOURLY_RATE } from "@/lib/quote/totals";

/** Compact hours display: whole when integer, else one decimal. */
function fmtHours(h: number): string {
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
}

/** Patch the quote content. Accepts a partial (merged onto the current content)
    or a functional updater. The dashboard wraps this with recomputeTotals so
    subtotals + grand total stay live as money fields change. */
export type QuotePatch = (p: Partial<QuoteContent> | ((prev: QuoteContent) => Partial<QuoteContent>)) => void;

export interface SectionBodyProps {
  content: QuoteContent;
  patch: QuotePatch;
}

// --- list-of-objects helper (mirrors prd-sections listPatch) ----------------
function listPatch<T>(arr: T[], patch: QuotePatch, key: keyof QuoteContent) {
  return {
    update: (i: number, p: Partial<T>) =>
      patch({ [key]: arr.map((it, idx) => (idx === i ? { ...it, ...p } : it)) } as Partial<QuoteContent>),
    remove: (i: number) => patch({ [key]: arr.filter((_, idx) => idx !== i) } as Partial<QuoteContent>),
    add: (blank: T) => patch({ [key]: [...arr, blank] } as Partial<QuoteContent>),
  };
}

// =====================================================================
//  Header
// =====================================================================
/* Client identity as small pills (Company / Prepared for / Product), shown
   below the quote title. Each value stays inline-editable; in preview the empty
   ones collapse so only filled pills render. */
export function QuoteIdentity({ content, patch }: SectionBodyProps) {
  const editing = useEditing();
  const fields = [
    { label: "Company", value: content.companyName, placeholder: "Client company", onChange: (v: string) => patch({ companyName: v }) },
    { label: "Prepared for", value: content.clientName, placeholder: "Client contact", onChange: (v: string) => patch({ clientName: v }) },
    {
      label: "Product",
      value: content.productSubtitle,
      placeholder: "e.g. AI Business Productivity + AI Calls MVP",
      onChange: (v: string) => patch({ productSubtitle: v }),
    },
  ];
  const visible = editing ? fields : fields.filter((f) => f.value);
  if (visible.length === 0) return null;
  return (
    <div className="quote-id-pills">
      {visible.map((f) => (
        <span className="quote-id-pill" key={f.label}>
          <span className="quote-id-pill__label">{f.label}</span>
          <InlineText
            value={f.value}
            onChange={f.onChange}
            placeholder={f.placeholder}
            className="quote-id-pill__value"
          />
        </span>
      ))}
    </div>
  );
}

// =====================================================================
//  Cost breakdown — modules + line items (the core)
// =====================================================================
function ModuleLineItems({
  module,
  onChange,
}: {
  module: QuoteModule;
  onChange: (lineItems: BriefLineItem[]) => void;
}) {
  const editing = useEditing();
  const items = module.lineItems ?? [];
  const update = (i: number, p: Partial<BriefLineItem>) =>
    onChange(items.map((it, idx) => (idx === i ? { ...it, ...p } : it)));
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const add = () => onChange([...items, { label: "", hours: null, amount: 0 }]);

  if (!editing && items.length === 0) return null;

  const totalHours = items.reduce((s, li) => s + (Number(li.hours) || 0), 0);

  return (
    <div className="lineitem-table">
      {items.map((li, i) => {
        // An item with hours is priced as hours × rate (computed, read-only).
        // One with hours left blank is a flat fee the builder types directly.
        const hasHours = li.hours != null;
        return (
          <div className="lineitem-row" key={i}>
            <InlineText
              value={li.label}
              onChange={(v) => update(i, { label: v })}
              placeholder="Line item"
              className="lineitem-label"
              multiline
            />
            {editing ? (
              <input
                type="number"
                min="0"
                step="0.5"
                value={li.hours ?? ""}
                onChange={(e) =>
                  update(i, { hours: e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0) })
                }
                placeholder="hrs"
                className="lineitem-hours"
                aria-label="Estimated hours"
              />
            ) : (
              hasHours && <span className="lineitem-hours-read">{fmtHours(li.hours as number)}h</span>
            )}
            {hasHours ? (
              <span className="lineitem-amount">{formatUSD(li.amount)}</span>
            ) : (
              <MoneyInput value={li.amount} onChange={(v) => update(i, { amount: v })} className="lineitem-amount" />
            )}
            {editing && (
              <button type="button" className="inline-remove" onClick={() => remove(i)} aria-label="Remove">
                ×
              </button>
            )}
          </div>
        );
      })}
      <div className="lineitem-row lineitem-row--subtotal">
        <span className="lineitem-label">
          Subtotal{totalHours > 0 ? ` · ${fmtHours(totalHours)} hrs` : ""}
        </span>
        {editing && <span className="lineitem-hours-spacer" aria-hidden="true" />}
        <span className="lineitem-amount">{formatUSD(module.cost)}</span>
        {editing && <span className="lineitem-spacer" />}
      </div>
      {editing && (
        <button type="button" className="inline-add" onClick={add}>
          + line item
        </button>
      )}
    </div>
  );
}

function ModulesBody({ content, patch }: SectionBodyProps) {
  const modules = content.modules ?? [];
  const h = listPatch(modules, patch, "modules");
  const editing = useEditing();
  if (!editing && modules.length === 0) return <p className="empty-note">No cost breakdown yet.</p>;
  return (
    <div className="card-stack">
      {editing && (
        <div className="quote-pricing-controls">
          <label className="quote-pricing-field">
            <span className="quote-pricing-field__label">Hourly rate</span>
            <span className="quote-rate-wrap">
              $
              <input
                type="number"
                min="0"
                step="5"
                value={content.hourlyRate ?? DEFAULT_QUOTE_HOURLY_RATE}
                onChange={(e) => patch({ hourlyRate: Math.max(0, Number(e.target.value) || 0) })}
                className="quote-rate-input"
                aria-label="Hourly rate"
              />
              <span className="quote-rate-suffix">/hr</span>
            </span>
          </label>
          <label className="quote-pricing-toggle">
            <input
              type="checkbox"
              checked={!!content.showHours}
              onChange={(e) => patch({ showHours: e.target.checked })}
            />
            <span>Show hours on the client quote</span>
          </label>
          <p className="quote-pricing-note">
            Line items with an hours estimate are priced as hours × rate. Leave hours blank to set a flat fee.
          </p>
        </div>
      )}
      {modules.map((m, i) => (
        <div className="prd-card" key={i}>
          <RemoveCard onClick={() => h.remove(i)} />
          <div className="prd-card__head">
            <InlineText
              value={m.title}
              onChange={(v) => h.update(i, { title: v })}
              placeholder="Module / product area"
              className="prd-card__title"
            />
            <span className="cost-pill module-cost">{formatUSD(m.cost)}</span>
          </div>
          <InlineText
            value={m.purpose}
            onChange={(v) => h.update(i, { purpose: v })}
            placeholder="One-line purpose"
            className="prd-card__desc"
          />
          <InlineText
            value={m.description}
            onChange={(v) => h.update(i, { description: v })}
            placeholder="What this module covers (optional)"
            className="prd-card__desc"
            multiline
          />
          <p className="prd-card__label">Line items</p>
          <ModuleLineItems module={m} onChange={(lineItems) => h.update(i, { lineItems })} />
        </div>
      ))}
      <AddButton
        label="Add module"
        onClick={() => h.add({ title: "", purpose: "", description: "", cost: 0, lineItems: [], subtotal: 0 })}
      />
      <div className="quote-grand">
        <span className="quote-grand__label">Total Project Quote</span>
        <span className="quote-grand__value">{formatUSD(content.totals?.grand)}</span>
      </div>
    </div>
  );
}

// =====================================================================
//  Design system inclusion checklist
// =====================================================================
function DesignSystemBody({ content, patch }: SectionBodyProps) {
  const rows = content.designSystem ?? [];
  const h = listPatch(rows, patch, "designSystem");
  const editing = useEditing();
  if (!editing && rows.length === 0) return <p className="empty-note">No design-system items yet.</p>;
  return (
    <div className="design-list">
      {rows.map((d, i) => (
        <div className="design-row" key={i}>
          {editing ? (
            <input
              type="checkbox"
              checked={d.included}
              onChange={(e) => h.update(i, { included: e.target.checked })}
              className="design-check"
              aria-label="Included"
            />
          ) : (
            <span className={"design-flag " + (d.included ? "design-flag--yes" : "design-flag--no")}>
              {d.included ? "✓" : "—"}
            </span>
          )}
          <InlineText
            value={d.component}
            onChange={(v) => h.update(i, { component: v })}
            placeholder="Design component"
            className="design-label"
            multiline
          />
          {editing && (
            <button type="button" className="inline-remove" onClick={() => h.remove(i)} aria-label="Remove">
              ×
            </button>
          )}
        </div>
      ))}
      <AddButton label="Add component" onClick={() => h.add({ component: "", included: true } as QuoteDesignComponent)} />
    </div>
  );
}

// =====================================================================
//  Payment structure
// =====================================================================
function PaymentMilestonesBody({ content, patch }: SectionBodyProps) {
  const rows = content.paymentMilestones ?? [];
  const h = listPatch(rows, patch, "paymentMilestones");
  const editing = useEditing();
  const grand = content.totals?.grand ?? 0;
  const paymentTotal = content.totals?.paymentTotal ?? 0;
  const mismatch = grand > 0 && Math.abs(paymentTotal - grand) > 0.5;
  if (!editing && rows.length === 0) return <p className="empty-note">No payment structure yet.</p>;
  return (
    <div className="payment-list">
      {rows.map((m, i) => (
        <div className="payment-row" key={i}>
          <InlineText
            value={m.label}
            onChange={(v) => h.update(i, { label: v })}
            placeholder="e.g. 50% upfront to begin"
            className="payment-label"
            multiline
          />
          <MoneyInput
            value={m.amount}
            onChange={(v) => h.update(i, { amount: v, percent: null })}
            className="payment-amount"
          />
          {editing && (
            <button type="button" className="inline-remove" onClick={() => h.remove(i)} aria-label="Remove">
              ×
            </button>
          )}
        </div>
      ))}
      <div className="payment-row payment-row--total">
        <span className="payment-label">Total</span>
        <span className="payment-amount">{formatUSD(paymentTotal)}</span>
        {editing && <span className="lineitem-spacer" />}
      </div>
      {mismatch && (
        <p className="estimate-banner">
          Payments total {formatUSD(paymentTotal)} but the quote total is {formatUSD(grand)} — adjust so they match.
        </p>
      )}
      <AddButton
        label="Add payment"
        onClick={() => h.add({ label: "", amount: 0 } as QuotePaymentMilestone)}
      />
    </div>
  );
}

// =====================================================================
//  Simple list / text section bodies via factory
// =====================================================================
const listBody =
  (key: keyof QuoteContent, variant: "bullet" | "ordered" | "check" | "plain", addLabel: string, ph: string) =>
  ({ content, patch }: SectionBodyProps): ReactNode =>
    (
      <InlineList
        items={(content[key] as string[]) ?? []}
        onChange={(v) => patch({ [key]: v } as Partial<QuoteContent>)}
        variant={variant}
        addLabel={addLabel}
        placeholder={ph}
      />
    );

const textBody =
  (key: keyof QuoteContent, ph: string) =>
  ({ content, patch }: SectionBodyProps): ReactNode =>
    (
      <InlineText
        value={content[key] as string | undefined}
        onChange={(v) => patch({ [key]: v } as Partial<QuoteContent>)}
        placeholder={ph}
        className="prose-text"
        multiline
        tag="p"
      />
    );

// =====================================================================
//  Section registry — order + numbering
// =====================================================================
export interface SectionDef {
  id: string;
  num?: string;
  title: string;
  hint?: string;
  Body: ComponentType<SectionBodyProps>;
}

/* Note: the "header" identity block (Company / Prepared for / Product) is no
   longer a rail section — the dashboard renders HeaderBody standalone above the
   summary cards. */
export const SECTIONS: SectionDef[] = [
  {
    id: "scopeSummary",
    title: "Scope Summary",
    hint: "A short paragraph summarizing what this quote covers.",
    Body: textBody("scopeSummary", "This quote covers…"),
  },
  {
    id: "costOverview",
    num: "1",
    title: "Cost Overview",
    hint: "The full quote total — build areas plus any add-ons, design, fees, or discounts. Edit the build areas in Cost Breakdown.",
    Body: QuoteCostOverview,
  },
  {
    id: "modules",
    num: "2",
    title: "Cost Breakdown",
    hint: "Each product area with its line items and price. Totals update as you edit.",
    Body: ModulesBody,
  },
  {
    id: "designSystem",
    num: "3",
    title: "Design System Included",
    hint: "UI/UX deliverables bundled into the product pricing.",
    Body: DesignSystemBody,
  },
  {
    id: "paymentMilestones",
    num: "4",
    title: "Payment Structure",
    hint: "How the total is split into payments. Amounts should sum to the quote total.",
    Body: PaymentMilestonesBody,
  },
  {
    id: "justification",
    num: "5",
    title: "Why This Price Is Justified",
    hint: "Plain-language reasons the price is fair.",
    Body: listBody("justification", "bullet", "reason", "Reason"),
  },
  {
    id: "scopeProtection",
    num: "6",
    title: "Scope Protection",
    hint: "What's NOT included unless separately quoted.",
    Body: listBody("scopeProtection", "bullet", "item", "Not included"),
  },
  {
    id: "footerNote",
    title: "Footer Note",
    hint: "A short closing note shown at the bottom of the quote.",
    Body: textBody("footerNote", "Prepared from the product PRD. Pricing is an implementation estimate…"),
  },
];
