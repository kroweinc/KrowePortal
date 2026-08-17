/** Shared Granola call-date formatting. Lifted out of
    import-from-granola-dialog.tsx so the picker, the meeting page and the task
    detail sheet can't drift into three different date formats for the same
    call. Pure and client-safe. */
export function formatCallDate(createdAt: string | null): string | null {
  if (!createdAt) return null;
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * How far back Granola will serve a call. Lives here, not in client.ts, because
 * the UI has to reason about it too and client.ts is `server-only`.
 *
 * This is not just `list_meetings`' paging window: **`get_meetings` is bound by
 * the same 30 days even when asked for an explicit note id.** Measured
 * 2026-08-10 against a live connection, bracketing the edge — 13d, 18d and 29d
 * old notes all came back; 31d, 32d, 49d and 66d all raised
 * GranolaNotFoundError. So a call ages out of reach entirely: no summary, no
 * transcript, no retry that can ever succeed.
 */
export const GRANOLA_HISTORY_DAYS = 30;

/** True when Granola will no longer serve this call — nothing we can fetch will
    bring it back, so the UI must say so rather than offering to try again. */
export function isBeyondGranolaHistory(callAt: string | null): boolean {
  if (!callAt) return false;
  const at = Date.parse(callAt);
  if (Number.isNaN(at)) return false;
  return Date.now() - at > GRANOLA_HISTORY_DAYS * 86_400_000;
}
