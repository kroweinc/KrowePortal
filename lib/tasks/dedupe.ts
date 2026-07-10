/**
 * Task de-duplication primitives — pure, no "server-only", no env, no network,
 * so they're unit-testable and safe to import from client components, server
 * actions, and the extraction post-processor alike.
 *
 * Two consumers share this:
 *   - lib/ai/extract-tasks-postprocess.ts — intra-batch merge of duplicate
 *     extracted drafts (jaccard / tokenCoverage on significant tokens).
 *   - createTask + the Granola review — flag a new/extracted task that looks
 *     like an existing OPEN task in the same engagement (findSimilarTitles).
 */

// ── Tokenization ─────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "the", "a", "an", "to", "of", "and", "or", "for", "in", "on", "at", "it",
  "its", "is", "are", "be", "was", "were", "with", "then", "that", "this",
  "his", "her", "their", "them", "they", "he", "she", "we", "i", "you", "your",
  "our", "from", "into", "up", "out", "as", "by", "will", "would", "should",
  "can", "could", "have", "has", "had", "do", "does", "did", "not", "all",
  "any", "also", "when", "once", "make", "get", "new",
]);

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

/** Lowercased significant tokens: words ≥3 chars (stopwords removed, trailing
    plural "s" stripped so "fields"/"field" match), all numbers, and whole
    email addresses kept intact. */
export function significantTokens(text: string): Set<string> {
  const out = new Set<string>();
  const lower = text.toLowerCase();
  for (const email of lower.match(EMAIL_RE) ?? []) out.add(email);
  // Hyphenated compounds ("docket-sheet") split so they match their spaced
  // spellings ("docket sheet").
  const stripped = lower.replace(EMAIL_RE, " ");
  for (const raw of stripped.match(/[a-z0-9][a-z0-9']*/g) ?? []) {
    const word = raw.replace(/'s$/, "");
    if (/^\d+$/.test(word)) {
      out.add(word);
    } else if (word.length >= 3 && !STOPWORDS.has(word)) {
      out.add(word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word);
    }
  }
  return out;
}

/** Fraction of `needle`'s significant tokens present in `haystack` (0..1). */
export function tokenCoverage(needle: Set<string>, haystack: Set<string>): number {
  if (needle.size === 0) return 0;
  let hit = 0;
  for (const t of needle) if (haystack.has(t)) hit++;
  return hit / needle.size;
}

/** Jaccard overlap of two token sets (0..1). */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// ── Title-level near-duplicate matching ──────────────────────────────────────

/** Collapse whitespace + lowercase — a stable key for "same title" lookups and
    for keying UI annotations by title. Token comparison does its own
    normalization; this is for display/keying. */
export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Two titles share enough words to be the same deliverable. */
const TITLE_DUP_JACCARD = 0.6;
/** …or one title's words are almost entirely contained in the other (catches
    "Stripe checkout" vs "Set up Stripe checkout flow"). Guarded by a 2-token
    floor so a single generic word ("login") can't match everything. */
const TITLE_DUP_COVERAGE = 0.85;

/** Whether two task titles are near-duplicates of each other. */
export function titlesAreSimilar(a: string, b: string): boolean {
  const ta = significantTokens(a);
  const tb = significantTokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  if (jaccard(ta, tb) >= TITLE_DUP_JACCARD) return true;
  const cover = Math.max(tokenCoverage(ta, tb), tokenCoverage(tb, ta));
  return Math.min(ta.size, tb.size) >= 2 && cover >= TITLE_DUP_COVERAGE;
}

export interface TitleCandidate {
  id: string;
  title: string;
}

export interface TitleMatch extends TitleCandidate {
  score: number;
}

/** Candidates whose title is a near-duplicate of `title`, best match first.
    Pure — the caller fetches the open-task rows and passes them in. */
export function findSimilarTitles(
  title: string,
  candidates: TitleCandidate[]
): TitleMatch[] {
  const tokens = significantTokens(title);
  if (tokens.size === 0) return [];
  const matches: TitleMatch[] = [];
  for (const c of candidates) {
    const ct = significantTokens(c.title);
    if (ct.size === 0) continue;
    const j = jaccard(tokens, ct);
    const cover = Math.max(tokenCoverage(tokens, ct), tokenCoverage(ct, tokens));
    const isDup = j >= TITLE_DUP_JACCARD || (Math.min(tokens.size, ct.size) >= 2 && cover >= TITLE_DUP_COVERAGE);
    if (isDup) matches.push({ id: c.id, title: c.title, score: Math.max(j, cover) });
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, 5);
}
