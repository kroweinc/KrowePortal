"use client";

/* Cost Overview — the consolidated cost summary, rendered as a rail section (the
   rail supplies the section card + "Cost Overview" title/hint). Mirrors the
   reference PDF's §1: the build (the product areas/modules, read-only — edit them
   in Cost Breakdown) plus editable "additional charges": design-system work,
   add-ons, fees, and discounts (which subtract). Each extra is a flat amount or a
   percent of the build subtotal. The grand total = build subtotal + extras and
   stays live because patch() wraps recomputeTotals. */

import type { QuoteExtraCostKind } from "@/lib/types";
import { InlineText, InlineSelect, AddButton, useEditing } from "@/components/prd/dashboard/inline-edit";
import { MoneyInput } from "./money-input";
import { formatUSD } from "@/lib/quote/format";
import type { SectionBodyProps } from "./quote-sections";

const KIND_OPTIONS: { value: QuoteExtraCostKind; label: string }[] = [
  { value: "design", label: "Design system" },
  { value: "addon", label: "Add-on" },
  { value: "fee", label: "Fee" },
  { value: "discount", label: "Discount" },
];

const kindLabel = (k: string): string => KIND_OPTIONS.find((o) => o.value === k)?.label ?? "Add-on";

export function QuoteCostOverview({ content, patch }: SectionBodyProps) {
  const editing = useEditing();
  const modules = content.modules ?? [];
  const extras = content.extraCosts ?? [];
  const modulesTotal = content.totals?.modulesTotal ?? 0;
  const grand = content.totals?.grand ?? 0;

  const filledExtras = extras.filter((e) => e.label || e.amount || e.percent);
  if (!editing && modules.length === 0 && filledExtras.length === 0)
    return <p className="empty-note">No costs yet.</p>;

  const update = (i: number, p: Partial<(typeof extras)[number]>) =>
    patch({ extraCosts: extras.map((it, idx) => (idx === i ? { ...it, ...p } : it)) });
  const remove = (i: number) => patch({ extraCosts: extras.filter((_, idx) => idx !== i) });
  const add = () => patch({ extraCosts: [...extras, { label: "", kind: "addon", amount: 0, percent: null }] });

  return (
    <div className="quote-overview">
      <div className="quote-overview__rows">
        {/* Build — the product areas/modules (read-only summary) */}
        {modules.map((m, i) => (
          <div className="quote-ov-row" key={`m${i}`}>
            <span className="quote-ov-row__name">{m.title || "Untitled area"}</span>
            <span className="quote-ov-row__amount money-value">{formatUSD(m.cost)}</span>
          </div>
        ))}
        {modules.length > 0 && (
          <div className="quote-ov-row quote-ov-row--subtotal">
            <span className="quote-ov-row__name">Build subtotal</span>
            <span className="quote-ov-row__amount money-value">{formatUSD(modulesTotal)}</span>
          </div>
        )}

        {/* Additional charges — design / add-ons / fees / discounts */}
        {(editing || filledExtras.length > 0) && (
          <div className="quote-overview__label">Additional charges</div>
        )}
        {extras.map((e, i) => {
          if (!editing && !e.label && !e.amount && !e.percent) return null;
          const isPercent = e.percent != null;
          const signed = (e.kind === "discount" ? -1 : 1) * (Number(e.amount) || 0);
          return (
            <div className="quote-ov-row quote-ov-row--extra" key={`x${i}`}>
              <InlineText
                value={e.label}
                onChange={(v) => update(i, { label: v })}
                placeholder="Charge name"
                className="quote-ov-row__name"
              />
              <span className="quote-ov-row__kind">
                <InlineSelect
                  value={e.kind}
                  onChange={(v) => update(i, { kind: v as QuoteExtraCostKind })}
                  options={KIND_OPTIONS}
                  render={kindLabel}
                />
              </span>
              {editing ? (
                <span className="quote-extra-value">
                  <span className="quote-extra-mode" role="group" aria-label="Amount type">
                    <button
                      type="button"
                      className={"quote-extra-mode__btn" + (!isPercent ? " is-active" : "")}
                      onClick={() => update(i, { percent: null })}
                      aria-pressed={!isPercent}
                    >
                      $
                    </button>
                    <button
                      type="button"
                      className={"quote-extra-mode__btn" + (isPercent ? " is-active" : "")}
                      onClick={() => update(i, { percent: typeof e.percent === "number" ? e.percent : 0 })}
                      aria-pressed={isPercent}
                    >
                      %
                    </button>
                  </span>
                  {isPercent ? (
                    <span className="quote-extra-pct">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={e.percent ?? ""}
                        onChange={(ev) =>
                          update(i, {
                            percent:
                              ev.target.value === ""
                                ? 0
                                : Math.max(0, Math.min(100, Number(ev.target.value) || 0)),
                          })
                        }
                        className="quote-extra-pct__input"
                        aria-label="Percent of build subtotal"
                      />
                      <span className="quote-extra-pct__suffix">%</span>
                      <span className="quote-extra-derived">
                        = {e.kind === "discount" ? "−" : ""}
                        {formatUSD(e.amount)}
                      </span>
                    </span>
                  ) : (
                    <MoneyInput
                      value={e.amount}
                      onChange={(v) => update(i, { amount: v })}
                      className="quote-ov-row__amount"
                    />
                  )}
                </span>
              ) : (
                <span className="quote-ov-row__amount money-value">{formatUSD(signed)}</span>
              )}
              {editing && (
                <button type="button" className="inline-remove" onClick={() => remove(i)} aria-label="Remove">
                  ×
                </button>
              )}
            </div>
          );
        })}
        <AddButton label="Add charge" onClick={add} />
      </div>

      <div className="quote-grand quote-overview__total">
        <span className="quote-grand__label">Total Project Quote</span>
        <span className="quote-grand__value">{formatUSD(grand)}</span>
      </div>
    </div>
  );
}
