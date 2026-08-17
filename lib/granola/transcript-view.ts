/**
 * The plain-text transcript format: the writer that flattens Granola's
 * segments into it, the parser that reads it back, and the quote anchoring
 * that maps a task's source line into it.
 *
 * Writer and reader live together on purpose — they are the two halves of one
 * format, and splitting them across a module boundary is how a format drifts.
 * Pure throughout (no "server-only", no network), so all of it is unit-testable
 * without a Granola session (tests/transcript-view.test.ts).
 */

import { normalizeForMatch } from "@/lib/ai/extract-tasks-postprocess";
import type { GranolaTranscriptSegment } from "@/lib/granola/client";

function speakerLabel(segment: GranolaTranscriptSegment): string {
  const speaker = segment.speaker;
  if (speaker?.source === "microphone") return "Me";
  // Prefer the real diarized name over the generic "Them" — owner attribution
  // in task extraction depends on participants keeping their names.
  if (speaker?.diarization_label) return speaker.diarization_label;
  if (speaker?.source === "speaker") return "Them";
  return "Speaker";
}

/**
 * Flattens transcript segments to readable plain text, merging consecutive
 * same-speaker segments into one paragraph:
 *
 *   Me: …\n\nThem: …
 *
 * A single unlabeled segment (plain-text transcript) passes through without
 * a speaker prefix. splitTranscript below is the inverse.
 */
export function transcriptToPlainText(segments: GranolaTranscriptSegment[]): string {
  if (segments.length === 1 && !segments[0].speaker) {
    return segments[0].text;
  }
  const paragraphs: { label: string; parts: string[] }[] = [];
  for (const segment of segments) {
    const label = speakerLabel(segment);
    const last = paragraphs[paragraphs.length - 1];
    if (last && last.label === label) {
      last.parts.push(segment.text.trim());
    } else {
      paragraphs.push({ label, parts: [segment.text.trim()] });
    }
  }
  return paragraphs.map((p) => `${p.label}: ${p.parts.join(" ")}`).join("\n\n");
}

export interface TranscriptLine {
  /** Null when the paragraph carried no `Label:` prefix. */
  speaker: string | null;
  text: string;
}

/**
 * What counts as a `Label:` prefix. We know exactly what the writer above
 * emits — "Me", "Them", "Speaker", or a diarization label, which is a person's
 * name — so the test is "short, and a name-shaped number of words".
 *
 * A length cap alone is not enough: "So here is the thing: we need…" clears any
 * cap generous enough for "Steven Ortega", and mis-parsing it swallows the
 * first clause of the sentence into the speaker column.
 */
const MAX_SPEAKER_LEN = 40;
const MAX_SPEAKER_WORDS = 3;
const SPEAKER_LINE = new RegExp(`^([^:\\n]{1,${MAX_SPEAKER_LEN}}):\\s+([\\s\\S]+)$`);

function isSpeakerLabel(candidate: string): boolean {
  const words = candidate.trim().split(/\s+/);
  if (words.length > MAX_SPEAKER_WORDS) return false;
  // A name doesn't end mid-punctuation; a truncated clause often does.
  return !/[,.;!?]$/.test(candidate.trim());
}

export function splitTranscript(raw: string): TranscriptLine[] {
  return raw
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((paragraph) => {
      const m = SPEAKER_LINE.exec(paragraph);
      return m && isSpeakerLabel(m[1])
        ? { speaker: m[1].trim(), text: m[2].trim() }
        : { speaker: null, text: paragraph };
    });
}

/** Below this a "quote" is too short to anchor confidently — matching on it
    would highlight an arbitrary line. Same floor findAnchorLine uses. */
const MIN_QUOTE_LEN = 8;
/** A quote may span two paragraphs; its first 60 normalized chars won't. */
const PROBE_LEN = 60;

/**
 * Which transcript line each task's quote came from.
 *
 * Deliberately exact-match only (the equivalent of findAnchorLine's Pass A) —
 * no token-coverage fallback. That fallback exists to *reconstruct* context for
 * the model, where a near-miss is better than nothing; here a near-miss puts a
 * highlight on the wrong sentence and quietly lies about where a task came
 * from. No highlight is the better failure.
 *
 * Returns line index → task ids. Several tasks legitimately anchor to the same
 * line, which is why the value is a list.
 */
export function locateQuotes(
  lines: TranscriptLine[],
  quotes: Array<{ taskId: string; quote: string | null }>
): Map<number, string[]> {
  const normalized = lines.map((l) => normalizeForMatch(l.text));
  const anchors = new Map<number, string[]>();

  for (const { taskId, quote } of quotes) {
    if (!quote) continue;
    const needle = normalizeForMatch(quote);
    if (needle.length < MIN_QUOTE_LEN) continue;
    const probe = needle.slice(0, PROBE_LEN);

    const index = normalized.findIndex(
      (line) => line.includes(needle) || line.includes(probe)
    );
    if (index === -1) continue;

    const bucket = anchors.get(index);
    if (bucket) bucket.push(taskId);
    else anchors.set(index, [taskId]);
  }

  return anchors;
}

/**
 * Normalize while remembering where each output character came from, so a hit
 * found in normalized space can be sliced back out of the ORIGINAL text with
 * its real casing and punctuation intact. Mirrors normalizeForMatch exactly:
 * curly quotes folded, whitespace runs collapsed, trimmed, lowercased.
 */
function normalizeWithMap(text: string): { norm: string; map: number[] } {
  const out: string[] = [];
  const map: number[] = [];
  let pendingSpace = false;

  for (let i = 0; i < text.length; i++) {
    let ch = text[i];
    if (ch === "“" || ch === "”") ch = '"';
    else if (ch === "‘" || ch === "’") ch = "'";

    if (/\s/.test(ch)) {
      // Leading whitespace is dropped (out is empty); trailing never flushes.
      pendingSpace = out.length > 0;
      continue;
    }
    if (pendingSpace) {
      out.push(" ");
      map.push(i);
      pendingSpace = false;
    }
    out.push(ch.toLowerCase());
    map.push(i);
  }

  return { norm: out.join(""), map };
}

export interface QuoteSplit {
  before: string;
  hit: string;
  after: string;
}

/** Split a line around its quote so the page can wrap the hit in a <mark>.
    Null when the quote isn't in this line — the caller renders it plain. */
export function splitOnQuote(text: string, quote: string | null): QuoteSplit | null {
  if (!quote) return null;
  const needle = normalizeForMatch(quote);
  if (needle.length < MIN_QUOTE_LEN) return null;

  const { norm, map } = normalizeWithMap(text);
  let index = norm.indexOf(needle);
  let length = needle.length;
  if (index === -1) {
    const probe = needle.slice(0, PROBE_LEN);
    index = norm.indexOf(probe);
    length = probe.length;
  }
  if (index === -1) return null;

  const start = map[index];
  const end = map[Math.min(index + length - 1, map.length - 1)] + 1;
  return { before: text.slice(0, start), hit: text.slice(start, end), after: text.slice(end) };
}
