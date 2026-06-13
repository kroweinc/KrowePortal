/* Currency formatting + parsing shared by the quote editor, document, and stat
   strip. Amounts are stored as plain numbers (whole dollars in practice). */

export function formatUSD(n: number | null | undefined, opts?: { cents?: boolean }): string {
  const v = Number(n) || 0;
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: opts?.cents ? 2 : 0,
    maximumFractionDigits: opts?.cents ? 2 : 0,
  });
}

/** Parse a free-text money string ("$1,200", "1200.50", "1,200") to a number.
    Returns 0 for empty/garbage. */
export function parseMoney(s: string): number {
  const cleaned = (s ?? "").replace(/[^0-9.]/g, "");
  if (!cleaned) return 0;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}
