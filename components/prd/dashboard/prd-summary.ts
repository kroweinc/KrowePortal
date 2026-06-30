/* Summary-strip math for the PRD dashboard. Ported from the Claude Design
   prototype's prd-data.js helpers, typed against PrdContent. */

import type { PrdContent } from "@/lib/types";

// Parse "~$35/mo", "$0/mo" → number. Returns null when no figure present.
export function parseCost(s?: string | null): number | null {
  if (!s) return null;
  const m = String(s).replace(/,/g, "").match(/(\d+(\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

export function monthlyTotal(content: PrdContent): { sum: number; estimated: boolean } {
  let sum = 0;
  let estimated = false;
  const all = [...(content.techStack ?? []), ...(content.integrations ?? [])];
  for (const it of all) {
    const n = parseCost(it.monthlyCost);
    if (n != null) {
      sum += n;
      if (it.estimated) estimated = true;
    }
  }
  return { sum, estimated };
}

// Strip the recurring-period suffix so a paid-cost string renders with the stat
// card's own unit, e.g. "~$25–45/mo" → "~$25–45", "$30 per month" → "$30".
function stripPeriod(s: string): string {
  return s.replace(/\s*\/?\s*(per\s+)?mo(nth)?\.?\b/gi, "").trim();
}

// Keep ONLY the price range, never the prose around it. The model sometimes
// returns a whole sentence for a cost figure (e.g. "~$0-$70 excluding developer
// services and any paid Google Workspace seats already in use") — the stat card
// and cost pill must show just the money: "~$0-$70". Pulls the leading
// $-figure (optionally a range) and drops everything after; if there's no
// $-figure at all, falls back to the period-stripped string.
const PRICE_RANGE = /[~<≈]?\s*\$\s*\d[\d,]*(?:\.\d+)?(?:\s*(?:[-–—]|to)\s*\$?\s*\d[\d,]*(?:\.\d+)?)?/;
export function priceRange(s?: string | null): string | null {
  if (!s) return null;
  const m = String(s).match(PRICE_RANGE);
  return m ? m[0].replace(/\s+/g, " ").trim() : stripPeriod(String(s));
}

// The headline monthly cost. The Free-Tier Fit verdict (§15) is the authoritative
// source of what the product actually costs to RUN: if every service fits its
// free tier the bill is $0, otherwise it's the summed minimum of the paid tiers
// the analysis says are needed. We derive the stat from that verdict when one
// exists, and only fall back to summing the per-item monthlyCost figures when the
// builder hasn't run the free-tier check yet.
export function monthlyCost(content: PrdContent): {
  display: string; // big-number portion, e.g. "$0", "~$25–45", "$35"
  unit: string; // "/mo" or "/mo est."
  sub: string; // caption under the value
  source: "free-tier" | "items";
} {
  const services = (content.techStack ?? []).length + (content.integrations ?? []).length;
  const a = content.freeTierAnalysis;

  if (a && (a.services?.length ?? 0) > 0) {
    const n = a.services!.length;
    const paid = a.totalMonthlyCostIfPaid?.trim();
    if (paid) {
      const label = a.overallFitsFree === "no" ? "paid tier needed" : "may need paid tier";
      return { display: priceRange(paid) ?? stripPeriod(paid), unit: "/mo est.", sub: `${n} services · ${label}`, source: "free-tier" };
    }
    // No paid figure + a clean "yes" verdict ⇒ it runs entirely on free tiers.
    if (a.overallFitsFree === "yes") {
      return { display: "$0", unit: "/mo", sub: `${n} services · fits free tier`, source: "free-tier" };
    }
    // "risky"/"no" but the model gave no figure — fall through to the item sum.
  }

  const { sum, estimated } = monthlyTotal(content);
  const priced = [...(content.techStack ?? []), ...(content.integrations ?? [])].filter(
    (i) => parseCost(i.monthlyCost) != null
  ).length;
  return {
    display: `${estimated ? "~" : ""}$${sum}`,
    unit: `/mo${estimated ? " est." : ""}`,
    sub: `${services} services · ${priced} priced`,
    source: "items",
  };
}

// Rough build-time estimate for a SOLO developer working with Claude Code.
// It is a heuristic, not a quote: it scales off the concrete scope already in
// the PRD — features weighted by priority, third-party integrations, and a
// fixed setup/deploy base — and assumes AI-accelerated velocity, so the
// per-unit hours are deliberately low. Recomputes live as the builder edits,
// mirroring monthlyTotal/launch. Returns null until there's something to size.
const BASE_HOURS = 8; // scaffold, auth, hosting, deploy
const PRIORITY_HOURS: Record<"must" | "should" | "could", number> = { must: 6, should: 4, could: 2 };
const INTEGRATION_HOURS = 3; // wiring + testing each 3rd-party service
const WORKDAY_HOURS = 6; // focused hours/day → day-equivalent

export function buildEstimate(content: PrdContent): { hours: number; days: number } | null {
  const features = content.features ?? [];
  const integrations = content.integrations ?? [];
  if (features.length === 0 && integrations.length === 0) return null;

  let hours = BASE_HOURS;
  for (const f of features) {
    const p = (f.priority ?? "should") as keyof typeof PRIORITY_HOURS;
    hours += PRIORITY_HOURS[p] ?? PRIORITY_HOURS.should;
  }
  hours += integrations.length * INTEGRATION_HOURS;

  return { hours, days: Math.max(1, Math.round(hours / WORKDAY_HOURS)) };
}

// Launch = the milestone literally named "Launch", else the last one.
export function launch(content: PrdContent): { label: string; due: string; count: number } | null {
  const ms = content.milestoneList ?? [];
  if (!ms.length) return null;
  const named = ms.find((m) => /launch/i.test(m.label));
  const target = named ?? ms[ms.length - 1];
  return { label: target.label, due: target.dueDate ?? "", count: ms.length };
}
