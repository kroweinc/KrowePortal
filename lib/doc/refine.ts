/* Shared pieces of the "refine one section from an instruction" flow, for both
   the PRD and the quote. Deliberately document-agnostic — no PrdContent /
   QuoteContent imports — so one implementation serves both dashboards. */

/** The builder's instruction: long enough to mean something, short enough to stay
    an instruction. Mirrored by the zod schemas in the two server actions. */
export const MIN_INSTRUCTION = 3;
export const MAX_INSTRUCTION = 1000;

// ── Which keys the model actually changed ───────────────────────────────────

/**
 * The keys the model actually filled in, read from the RAW response.
 *
 * Strict mode forces every key of the response schema into `required`, so a key
 * the instruction didn't touch arrives as `null` (which is what the prompt asks
 * for). That signal does not survive parsing: `stripNullsDeep` drops the null,
 * and `ContentSchema.partial()` then re-materializes `[]` for it, because
 * `.partial()` keeps the field's `.default([])`. An untouched list would come
 * back as an empty array and wipe the section on merge.
 *
 * So the raw JSON is the only place "the model left this alone" still exists —
 * read it there, before parsing, and intersect afterwards.
 */
export function providedKeys(rawPatch: unknown): Set<string> {
  if (!rawPatch || typeof rawPatch !== "object" || Array.isArray(rawPatch)) return new Set();
  const out = new Set<string>();
  for (const [k, v] of Object.entries(rawPatch as Record<string, unknown>)) {
    if (v !== null && v !== undefined) out.add(k);
  }
  return out;
}

/**
 * Narrow a parsed patch to the keys this section owns AND the model actually
 * changed. The section filter is a hard guard so a refine can never clobber
 * another section, whatever comes back.
 */
export function scopePatch<T>(
  parsed: Record<string, unknown>,
  fields: string[],
  provided: Set<string>
): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const k of fields) if (provided.has(k) && k in parsed) out[k] = parsed[k];
  return out as Partial<T>;
}

// ── What changed, for the preview ───────────────────────────────────────────

export type ItemStatus = "new" | "kept";

export interface ListDiff {
  /** Status per item of the proposed array, index-aligned. */
  status: ItemStatus[];
  /** Current items with no counterpart in the proposal. */
  removed: unknown[];
}

/** The field an object item is identified by, most specific first. One entry per
    shape the refinable sections actually hold: `name` (PrdIntegration,
    PrdStackItem, PrdPage), `title` (PrdFeature, QuoteModule), `label`
    (PrdMilestone, QuoteExtraCost, QuotePaymentMilestone), `role` (PrdUserRole,
    PrdUxFlow), `data` (PrdDataSource), `component` (QuoteDesignComponent).
    A shape missing from this list falls back to whole-value matching, which
    reports any edit as a remove + an add — so add the key when adding a shape.
    Deliberately NOT `id`: it's optional on the quote types and the model has no
    reason to echo it back, so matching on it would call every kept row new. */
const IDENTITY_KEYS = ["name", "title", "label", "role", "data", "component"] as const;

/** Stable key for matching an item across the two arrays. Objects match on their
    identity field so an edited description still reads as the same entry; anything
    else matches on its whole value. */
function identityOf(item: unknown): string {
  if (item != null && typeof item === "object" && !Array.isArray(item)) {
    const obj = item as Record<string, unknown>;
    for (const key of IDENTITY_KEYS) {
      const value = obj[key];
      if (typeof value === "string" && value.trim()) return value.trim().toLowerCase();
    }
  }
  if (typeof item === "string") return item.trim().toLowerCase();
  return canonical(item);
}

/** Order-insensitive JSON so two equal objects with different key order match. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value != null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined && v !== null)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * Per-item status for a proposed array against the current one, plus what dropped
 * out. Returns null when either side isn't an array — callers fall back to a
 * whole-value changed/unchanged badge.
 *
 * Matching is by identity, not position, so reordering a list reads as kept.
 * Duplicate identities are consumed one-for-one: a second copy of an entry that
 * exists once today is genuinely new, and whatever is left unconsumed was removed.
 */
export function diffList(current: unknown, next: unknown): ListDiff | null {
  if (!Array.isArray(current) || !Array.isArray(next)) return null;

  const unmatched = new Map<string, number[]>();
  current.forEach((item, i) => {
    const key = identityOf(item);
    const at = unmatched.get(key);
    if (at) at.push(i);
    else unmatched.set(key, [i]);
  });

  const status: ItemStatus[] = next.map((item) => {
    const at = unmatched.get(identityOf(item));
    return at?.shift() === undefined ? "new" : "kept";
  });

  // Whatever is still in a bucket was never consumed above, so it's gone.
  const leftover = [...unmatched.values()].flat().sort((a, b) => a - b);
  return { status, removed: leftover.map((i) => current[i]) };
}

/** Deep-equal by canonical JSON — for strings, objects, and the non-array fallback. */
export function isUnchanged(current: unknown, next: unknown): boolean {
  return canonical(current) === canonical(next);
}
