/* Pure totals math for a quote breakdown. Used both client-side (the dashboard
   recomputes on every money edit so subtotals + the grand total stay live) and
   server-side (a guard on draft/refine/save so a row is always internally
   consistent even if the model's arithmetic drifted).

   Pricing is effort-based, exactly like a brief: an hour-based line item is
   priced as `hours × hourlyRate`. Flat-fee items (hours left blank) keep their
   typed amount, which also keeps legacy amount-only quotes working unchanged.

   "Cost Overview" extras (add-ons, design, fees, discounts) price on top of the
   build: a flat amount, or a percent of the build subtotal. A discount subtracts.

   Invariants enforced:
   - each hour-based lineItem.amount === round(hours × hourlyRate)
   - each module.subtotal === Σ its lineItems[].amount
   - each module.cost === module.subtotal  (a module's price is its line items)
   - totals.modulesTotal === Σ module.cost  (the build subtotal)
   - each percent-based extra.amount === round(percent/100 × modulesTotal)
   - totals.extrasTotal === Σ extras  (discounts subtract; may be negative)
   - totals.grand === max(0, modulesTotal + extrasTotal)
   - totals.paymentTotal === Σ paymentMilestones[].amount */

import type { BriefLineItem, QuoteContent, QuoteExtraCost } from "@/lib/types";

/** Default blended rate quotes price from when the builder hasn't set one. */
export const DEFAULT_QUOTE_HOURLY_RATE = 45;

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

/* Reprice an hour-based item at the current rate; leave flat-fee items (no
   hours) on their typed amount. Mirrors the brief editor's repriceHourItems. */
function repriceLineItem(li: BriefLineItem, rate: number): BriefLineItem {
  if (li.hours != null && Number.isFinite(Number(li.hours))) {
    return { ...li, amount: Math.round(Number(li.hours) * rate) };
  }
  return li;
}

/* Reprice a percent-based extra off the build subtotal; leave flat extras on
   their typed amount. The discount sign is applied later, in extrasTotal. */
function repriceExtra(e: QuoteExtraCost, modulesTotal: number): QuoteExtraCost {
  if (e.percent != null && Number.isFinite(Number(e.percent))) {
    return { ...e, amount: Math.round((Number(e.percent) / 100) * modulesTotal) };
  }
  return e;
}

export function recomputeTotals(content: QuoteContent): QuoteContent {
  const rate = content.hourlyRate ?? DEFAULT_QUOTE_HOURLY_RATE;
  const modules = (content.modules ?? []).map((m) => {
    const lineItems = (m.lineItems ?? []).map((li) => repriceLineItem(li, rate));
    const subtotal = round2(lineItems.reduce((sum, li) => sum + (Number(li.amount) || 0), 0));
    return { ...m, lineItems, subtotal, cost: subtotal };
  });

  const modulesTotal = round2(modules.reduce((sum, m) => sum + (Number(m.cost) || 0), 0));

  // Cost Overview extras price on top of the build (a discount subtracts).
  const extraCosts = (content.extraCosts ?? []).map((e) => repriceExtra(e, modulesTotal));
  const extrasTotal = round2(
    extraCosts.reduce((sum, e) => sum + (e.kind === "discount" ? -1 : 1) * (Number(e.amount) || 0), 0)
  );

  const grand = round2(Math.max(0, modulesTotal + extrasTotal));
  const paymentTotal = round2(
    (content.paymentMilestones ?? []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
  );

  return {
    ...content,
    modules,
    extraCosts,
    totals: {
      ...content.totals,
      grand,
      modulesTotal,
      extrasTotal,
      paymentTotal,
    },
  };
}

/* Fill each percent-based milestone's amount from the grand total
   (amount = round(grand × percent / 100)). Milestones with no percent are
   "pinned" — the builder typed a fixed dollar amount — so they keep their value
   and are subtracted from the pool first. The last percent-based milestone then
   absorbs whatever remains (pinned amounts + rounding) so the milestones always
   sum to grand. With every milestone pinned (no percents) this is a no-op and
   the mismatch banner is left to guide the builder. */
export function applyMilestonePercents(content: QuoteContent): QuoteContent {
  const grand = round2(content.totals?.grand ?? 0);
  const milestones = content.paymentMilestones ?? [];
  const percentIdxs = milestones
    .map((m, i) => (typeof m.percent === "number" ? i : -1))
    .filter((i) => i >= 0);
  if (grand <= 0 || percentIdxs.length === 0) return content;

  const next = milestones.map((m) => ({ ...m }));
  // Seed with the pinned (non-percent) amounts so percent milestones fill the
  // remainder around them and the whole set still ties out to grand.
  let allocated = round2(
    next.reduce((sum, m) => (typeof m.percent === "number" ? sum : sum + (Number(m.amount) || 0)), 0)
  );
  percentIdxs.forEach((idx, n) => {
    if (n === percentIdxs.length - 1) {
      next[idx].amount = round2(grand - allocated);
    } else {
      const amt = round2((grand * (next[idx].percent ?? 0)) / 100);
      next[idx].amount = amt;
      allocated = round2(allocated + amt);
    }
  });

  return recomputeTotals({ ...content, paymentMilestones: next });
}
