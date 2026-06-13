import type { ContractContent, QuoteContent } from "@/lib/types";

/**
 * Snapshot the financial + scope exhibit from the project's quote into the
 * contract at draft / regenerate time.
 *
 * A contract is e-signed, so these numbers are FROZEN into the contract's own
 * content — never read live from the quote. Editing the quote later must not
 * mutate a signed agreement, and the public sign page (admin client, token
 * only) has no access to the quote at all. This is also deterministic on
 * purpose: it keeps the dollar amounts out of the AI's hands.
 *
 *  • Exhibit A — Scope of Work  ← quote build modules (title · purpose · cost)
 *  • Exhibit B — Payment Schedule ← quote payment milestones (label · amount)
 */
export function exhibitFromQuote(
  q?: QuoteContent
): Pick<ContractContent, "quoteTotal" | "paymentSchedule" | "scopeItems"> {
  if (!q) return {};
  return {
    quoteTotal: q.totals?.grand ?? null,
    scopeItems: (q.modules ?? []).map((m) => ({
      title: m.title,
      purpose: m.purpose ?? null,
      cost: m.cost ?? null,
    })),
    paymentSchedule: (q.paymentMilestones ?? []).map((m) => ({
      label: m.label,
      amount: m.amount,
      percent: m.percent ?? null,
    })),
  };
}
