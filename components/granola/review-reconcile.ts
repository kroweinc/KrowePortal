import type { ExtractedTaskDraft } from "@/lib/ai/schemas";

/**
 * Decides how the review's local rows react to a new `drafts` snapshot.
 *
 * While streaming, `drafts` grows one raw model item at a time — new tail rows
 * append without touching existing ones. But the terminal `done` payload is
 * the finalizeExtraction output (owner repairs, merged duplicates, appended
 * checklist entries, synthesized missing tasks) and can have the SAME length
 * as what streamed, so a length check alone would silently keep the unrepaired
 * rows. The streaming flag transition is therefore the authoritative signal:
 * any flip rebuilds wholesale from `drafts` (stream end swaps in the finalized
 * array; a fresh stream start discards rows from a previous run).
 *
 * Returns the next rows, or null when the current rows should be kept.
 */
export function reconcileDraftRows<Row>(
  rows: readonly Row[],
  drafts: readonly ExtractedTaskDraft[],
  streaming: boolean,
  prevStreaming: boolean,
  toRow: (d: ExtractedTaskDraft) => Row
): Row[] | null {
  if (streaming !== prevStreaming) return drafts.map(toRow);
  if (drafts.length === rows.length) return null;
  return drafts.length > rows.length
    ? [...rows, ...drafts.slice(rows.length).map(toRow)]
    : drafts.map(toRow);
}
