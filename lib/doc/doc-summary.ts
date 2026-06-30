import type { Prd, Quote } from "@/lib/types";

// One-line summaries for a document row — date created plus the latest lifecycle
// event, and (for quotes) the grand total. Mirrors the inline helpers on the
// builder project page so every doc list reads the same.

export function formatDocDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function quoteDocMeta(q: Quote): string {
  const total = q.content?.totals?.grand;
  const parts: string[] = [`Created ${formatDocDate(q.created_at)}`];
  if (q.signed_at) parts.push(`Accepted ${formatDocDate(q.signed_at)}`);
  else if (q.sent_at) parts.push(`Sent ${formatDocDate(q.sent_at)}`);
  if (typeof total === "number" && total > 0) {
    parts.push(
      total.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      })
    );
  }
  return parts.join(" · ");
}

export function docMeta(d: Pick<Prd, "created_at" | "signed_at" | "sent_at">): string {
  const parts: string[] = [`Created ${formatDocDate(d.created_at)}`];
  if (d.signed_at) parts.push(`Signed ${formatDocDate(d.signed_at)}`);
  else if (d.sent_at) parts.push(`Sent ${formatDocDate(d.sent_at)}`);
  return parts.join(" · ");
}
