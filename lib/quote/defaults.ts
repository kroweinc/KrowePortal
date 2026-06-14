/* Builder pricing defaults applied to a freshly generated quote so every new
   quote starts from the builder's configured base (rate, payment terms, design
   system). Pure — no I/O — so it's safe to import from both the server (draftQuote)
   and the client (the settings editor's live preview).

   Contract: applyPricingDefaults runs BEFORE recomputeTotals / applyMilestonePercents.
   It seeds milestone percents (amount 0) and a flat design charge; the totals
   pipeline then prices line items at the rate, sums the design fee into the grand
   total, and fills each milestone's dollar amount from the grand. */

import type {
  QuoteContent,
  QuotePaymentMilestone,
  QuoteExtraCost,
  PaymentTermsPreset,
  DesignSystemMode,
} from "@/lib/types";
import { DEFAULT_QUOTE_HOURLY_RATE } from "@/lib/quote/totals";

/** The pricing defaults draftQuote loads from builder_profiles (or falls back to). */
export interface PricingDefaults {
  hourlyRate: number;
  paymentTermsPreset: PaymentTermsPreset;
  designSystemMode: DesignSystemMode;
  designFixedCost: number;
}

/** Matches the DB column defaults (0058) and the prior hardcoded behavior, so a
    builder with no row drafts exactly as quotes did before this feature. */
export const PRICING_DEFAULTS_FALLBACK: PricingDefaults = {
  hourlyRate: DEFAULT_QUOTE_HOURLY_RATE,
  paymentTermsPreset: "50_25_25",
  designSystemMode: "included",
  designFixedCost: 0,
};

/* Editorial milestone templates. amount is left at 0 — applyMilestonePercents
   fills each from the grand total via the percent. Percents sum to 100. */
const PAYMENT_TEMPLATES: Record<PaymentTermsPreset, { label: string; percent: number }[]> = {
  "50_25_25": [
    { label: "50% upfront to begin development", percent: 50 },
    { label: "25% after core features work", percent: 25 },
    { label: "25% before final launch and handoff", percent: 25 },
  ],
  "50_50": [
    { label: "50% upfront to begin development", percent: 50 },
    { label: "50% before final launch and handoff", percent: 50 },
  ],
  "100_upfront": [{ label: "100% upfront to begin development", percent: 100 }],
  "34_33_33": [
    { label: "Initial payment to begin development", percent: 34 },
    { label: "Progress payment at the midpoint", percent: 33 },
    { label: "Final payment before launch and handoff", percent: 33 },
  ],
};

/** Human labels for the settings dropdown. */
export const PAYMENT_TERMS_LABELS: Record<PaymentTermsPreset, string> = {
  "50_25_25": "50 / 25 / 25",
  "50_50": "50 / 50",
  "100_upfront": "100% upfront",
  "34_33_33": "Thirds (34 / 33 / 33)",
};

/** Human labels for the design-system mode control. */
export const DESIGN_SYSTEM_LABELS: Record<DesignSystemMode, string> = {
  included: "Included / bundled — no separate charge",
  fixed: "Fixed cost — add a design charge",
  none: "Not included — no design line",
};

/** Preset key → milestone rows (amount 0; percents drive applyMilestonePercents). */
export function paymentMilestonesForPreset(preset: PaymentTermsPreset): QuotePaymentMilestone[] {
  return (PAYMENT_TEMPLATES[preset] ?? PAYMENT_TEMPLATES["50_25_25"]).map((m) => ({
    label: m.label,
    amount: 0,
    percent: m.percent,
  }));
}

const DESIGN_EXTRA_LABEL = "Design system";

/**
 * Seed a freshly generated quote with the builder's defaults. Returns a new
 * content object and does NOT recompute totals — the caller wraps the result in
 * applyMilestonePercents(recomputeTotals(...)) so amounts derive correctly.
 *
 * - hourlyRate: always overwritten (the model's value is a placeholder).
 * - paymentMilestones: replaced with the preset template (the base; still editable).
 * - design: any existing kind:"design" extra is stripped first (idempotent), then
 *     "included" keeps the designSystem[] checklist with no charge,
 *     "fixed"    adds one design extraCost of designFixedCost and clears the checklist,
 *     "none"     adds no charge and clears the checklist.
 */
export function applyPricingDefaults(content: QuoteContent, defaults: PricingDefaults): QuoteContent {
  const next: QuoteContent = { ...content };

  next.hourlyRate = defaults.hourlyRate;
  next.paymentMilestones = paymentMilestonesForPreset(defaults.paymentTermsPreset);

  const withoutDesignExtra = (next.extraCosts ?? []).filter((e) => e.kind !== "design");

  if (defaults.designSystemMode === "fixed") {
    const designExtra: QuoteExtraCost = {
      label: DESIGN_EXTRA_LABEL,
      kind: "design",
      amount: defaults.designFixedCost,
      percent: null,
    };
    next.extraCosts = [...withoutDesignExtra, designExtra];
    next.designSystem = []; // it's a separate paid charge, not a bundled checklist
  } else if (defaults.designSystemMode === "none") {
    next.extraCosts = withoutDesignExtra;
    next.designSystem = [];
  } else {
    // included: keep the model's designSystem[] checklist, no separate charge.
    next.extraCosts = withoutDesignExtra;
  }

  return next;
}
