// The contract's effective date is system-managed: it shows the current date
// while the contract is a draft, then freezes to the day it's sent. These
// helpers produce / validate the `YYYY-MM-DD` form used for that frozen value.

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Local-time `YYYY-MM-DD` (not UTC), so it matches the calendar day the builder
// is actually looking at.
export function todayISODate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isISODate(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE_RE.test(value);
}
