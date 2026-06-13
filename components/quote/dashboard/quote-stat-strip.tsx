"use client";

/* Quote dashboard summary strip — the "Total Project Quote" banner plus two
   at-a-glance cards (modules and the quote's lifecycle status). Reuses the PRD
   stat-card styles. */

import type { QuoteContent, QuoteStatus } from "@/lib/types";
import { formatUSD } from "@/lib/quote/format";
import { DEFAULT_QUOTE_HOURLY_RATE } from "@/lib/quote/totals";

/* Per-state presentation: the dot color class + a plain sub-line that tells the
   builder what this state means and what's expected next. */
const STATUS_META: Record<QuoteStatus, { label: string; tone: string; sub: string }> = {
  draft: { label: "Draft", tone: "is-draft", sub: "Not sent yet — edit freely" },
  sent: { label: "Sent", tone: "is-sent", sub: "Awaiting the client's response" },
  signed: { label: "Signed", tone: "is-signed", sub: "Signed by the client" },
  accepted: { label: "Accepted", tone: "is-accepted", sub: "Accepted by the client" },
  rejected: { label: "Rejected", tone: "is-rejected", sub: "The client declined this quote" },
};

export function QuoteStatStrip({ content, status }: { content: QuoteContent; status: QuoteStatus }) {
  const grand = content.totals?.grand ?? 0;
  const moduleCount = content.modules?.length ?? 0;
  const lineItems = (content.modules ?? []).reduce((n, m) => n + (m.lineItems?.length ?? 0), 0);
  const totalHours = (content.modules ?? []).reduce(
    (h, m) => h + (m.lineItems ?? []).reduce((s, li) => s + (Number(li.hours) || 0), 0),
    0
  );
  const rate = content.hourlyRate ?? DEFAULT_QUOTE_HOURLY_RATE;
  const banner =
    totalHours > 0
      ? `${Number.isInteger(totalHours) ? totalHours : totalHours.toFixed(1)} hrs @ ${formatUSD(rate)}/hr`
      : `${lineItems} line items across the breakdown`;
  const state = STATUS_META[status] ?? STATUS_META.draft;

  return (
    <div className="stat-strip quote-stat-strip">
      <div className="stat-card stat-card--banner">
        <p className="stat-card__label">Total Project Quote</p>
        <p className="stat-card__value">
          <span className="stat-card__num quote-banner__num">{formatUSD(grand)}</span>
        </p>
        <p className="stat-card__sub">{banner}</p>
      </div>
      <div className="stat-card">
        <p className="stat-card__label">Modules</p>
        <p className="stat-card__value">
          <span className="stat-card__num">{moduleCount || "—"}</span>
        </p>
        <p className="stat-card__sub">product areas in this quote</p>
      </div>
      <div className="stat-card">
        <p className="stat-card__label">Status</p>
        <p className="stat-card__value">
          <span className={"quote-status-dot " + state.tone} aria-hidden="true" />
          <span className="stat-card__num quote-status-num">{state.label}</span>
        </p>
        <p className="stat-card__sub">{state.sub}</p>
      </div>
    </div>
  );
}
