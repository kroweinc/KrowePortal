import type { ExtractedTaskDraft } from "./schemas";
import { isBuilderOwnedDraft } from "./schemas";

/**
 * Deterministic post-processing for transcript task extraction
 * (lib/ai/extract-tasks-from-transcript.ts).
 *
 * Pure functions — no "server-only", no env, no network — so the safety net is
 * unit-testable without an OpenAI call (tests/extract-tasks-postprocess.test.ts).
 *
 * The model output is a good-faith first pass; this layer enforces the
 * guarantees a prompt alone cannot:
 *   1. owner normalization — "steven", "Me", the builder's display name and
 *      "builder" all become the canonical "builder"; other names get one
 *      canonical casing so "rahul"/"Rahul" compare equal downstream
 *   2. misattribution repair — a task whose grounding text traces to a bullet
 *      explicitly assigned to someone else gets that person back as owner;
 *      another participant's commitment never silently becomes builder work
 *   3. conservative semantic dedup — merge only same-deliverable duplicates
 *      (same source bullet, or near-identical titles); similar-but-distinct
 *      deliverables are never collapsed
 *   4. completeness — every explicitly assigned "Name: …" bullet in the notes
 *      must be covered by a task; an uncovered bullet becomes a fallback draft
 *      built verbatim from the bullet, so an assigned item can't be dropped
 *   5. requirement preservation — each sub-bullet / clause of a covered bullet
 *      (including exact emails, day counts, quoted copy, "then push it live")
 *      must appear in the matched task; missing clauses are appended to its
 *      checklist from the source text
 *   6. a repair log so every skip/fix is auditable instead of silent
 */

// ── Repair log ───────────────────────────────────────────────────────────────

export interface ExtractionRepair {
  kind:
    | "owner_normalized"
    | "owner_reattributed"
    | "duplicate_merged"
    | "missing_task_synthesized"
    | "requirement_appended"
    | "item_dropped";
  detail: string;
  sourceText?: string;
}

export interface PostProcessResult {
  items: ExtractedTaskDraft[];
  repairs: ExtractionRepair[];
}

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

function draftMatchTokens(d: ExtractedTaskDraft): Set<string> {
  // Grounding fields only — description may contain inferred context that
  // would blur which source bullet a task actually came from.
  return significantTokens(
    [d.title, d.sourceText ?? "", d.sourceQuote ?? "", ...(d.checklist ?? [])].join("\n")
  );
}

function draftFullTokens(d: ExtractedTaskDraft): Set<string> {
  return significantTokens(
    [d.title, d.description, d.sourceText ?? "", d.sourceQuote ?? "", ...(d.checklist ?? [])].join(
      "\n"
    )
  );
}

function draftContentTokens(d: ExtractedTaskDraft): Set<string> {
  // Actionable content ONLY — sourceText/sourceQuote quote the source bullet
  // verbatim, so counting them would make every lost requirement look
  // "preserved" in the requirement-preservation pass.
  return significantTokens([d.title, d.description, ...(d.checklist ?? [])].join("\n"));
}

// ── Owner normalization ──────────────────────────────────────────────────────

/**
 * Canonicalize an owner name. Anything referring to the builder ("builder",
 * "me", their display name or its first name) → exactly "builder"; other names
 * → trimmed Title Case so spelling variants compare equal.
 */
export function normalizeOwner(
  owner: string | undefined,
  builderAliases: string[]
): string | undefined {
  const raw = owner?.trim().replace(/\s+/g, " ").replace(/[.:;,]+$/, "");
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  const aliases = new Set(["builder", "me", "myself"]);
  for (const alias of builderAliases) {
    const full = alias.trim().toLowerCase();
    if (!full) continue;
    aliases.add(full);
    aliases.add(full.split(" ")[0]);
  }
  if (aliases.has(lower)) return "builder";
  return lower
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Post-extraction assignee filter: keep only one owner's tasks. Use
    "builder" for the builder's own board. */
export function filterDraftsByOwner(
  items: ExtractedTaskDraft[],
  owner: string
): ExtractedTaskDraft[] {
  if (owner === "builder") return items.filter((d) => isBuilderOwnedDraft(d.owner));
  const target = owner.trim().toLowerCase();
  return items.filter((d) => d.owner?.trim().toLowerCase() === target);
}

// ── Source-bullet parsing ────────────────────────────────────────────────────

export interface AssignedBullet {
  /** Owner name exactly as written in the notes ("Steven"). */
  owner: string;
  /** The bullet's first clause (before any ";" / ", then" split). */
  head: string;
  /** Every requirement clause: nested sub-bullets plus ";" / ", then" splits
      of the head line. Empty for single-requirement bullets. */
  clauses: string[];
  /** Full original text of the bullet including sub-bullets. */
  raw: string;
}

// Header-ish words that look like "Name:" but aren't assignments.
const NOT_A_NAME = new Set([
  "note", "notes", "summary", "action", "actions", "todo", "todos", "next",
  "agenda", "decision", "decisions", "update", "updates", "context",
  "background", "reminder", "reminders", "important", "question", "questions",
  "followup", "follow-up", "logic", "goal", "goals", "timing", "scope",
  "deadline", "deadlines", "example", "examples", "status", "priority",
  "priorities", "risk", "risks", "blocker", "blockers", "budget", "owner",
  "due",
]);

const BULLET_LINE = /^(\s*)(?:[-*•]|\d+[.)])\s+(.*)$/;
// 1–2 capitalized words followed by ":" — "Steven:", "Chris Stanton:".
const ASSIGNMENT = /^([A-Z][\w'.-]*(?: [A-Z][\w'.-]*)?)\s*:\s+(\S.*)$/;

function splitClauses(text: string): string[] {
  return text
    .split(/;|,\s*(?=then\b)/i)
    .map((c) => c.replace(/^then\s+/i, "").replace(/[.,;:\s]+$/, "").trim())
    .filter((c) => c.length > 0);
}

/**
 * Find every explicitly assigned action-item bullet ("- Name: do the thing")
 * in the meeting notes, with its nested sub-bullets as requirement clauses.
 * Lines that don't match the pattern are ignored — this is a best-effort
 * ground truth for the completeness pass, not a general parser.
 */
export function parseAssignedBullets(notes: string | null | undefined): AssignedBullet[] {
  if (!notes) return [];
  const lines = notes.split(/\r?\n/);
  const bullets: AssignedBullet[] = [];
  let current: (AssignedBullet & { indent: number }) | null = null;

  const flush = () => {
    if (current) {
      const { indent: _i, ...bullet } = current;
      bullets.push(bullet);
      current = null;
    }
  };

  for (const line of lines) {
    const m = line.match(BULLET_LINE);
    if (!m) {
      // Blank or prose line ends the current bullet's sub-list.
      if (line.trim().length === 0) flush();
      continue;
    }
    const [, indent, text] = m;
    if (current && indent.length > current.indent) {
      // Nested sub-bullet → a requirement clause of the current item.
      const clause = text.replace(/[.\s]+$/, "").trim();
      if (clause) {
        current.clauses.push(clause);
        current.raw += `\n${line.trim()}`;
      }
      continue;
    }
    flush();
    const assigned = text.match(ASSIGNMENT);
    if (!assigned) continue;
    const [, name, body] = assigned;
    if (NOT_A_NAME.has(name.toLowerCase())) continue;
    const clauses = splitClauses(body);
    current = {
      owner: name,
      head: clauses[0] ?? body.trim(),
      // The head split only counts as multiple clauses when there really were
      // several requirements on the line; single-clause heads stay clause-free.
      clauses: clauses.length > 1 ? clauses : [],
      raw: line.trim(),
      indent: indent.length,
    };
  }
  flush();
  return bullets;
}

// ── Source-text reconstruction ───────────────────────────────────────────────

export interface ReconstructContext {
  /** Meeting notes/summary, searched before the transcript so reconstruction
      stays aligned with the bullet matching that also runs on the notes. */
  summary: string | null | undefined;
  transcript: string;
}

/** Curly quotes and whitespace runs are the only variance a "verbatim" model
    quote realistically has against the source document. */
function normalizeForMatch(text: string): string {
  return text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Line-token score floor for the no-quote fallback anchor. */
const RECONSTRUCT_MATCH_THRESHOLD = 0.6;

function findAnchorLine(
  lines: string[],
  quote: string | undefined,
  needle: Set<string>
): number {
  // Pass A — exact quote anchor. A hit is confident regardless of token scores.
  const normQuote = quote ? normalizeForMatch(quote) : "";
  if (normQuote.length >= 8) {
    // For quotes spanning lines, the first 60 normalized chars sit on one line.
    const probe = normQuote.slice(0, 60);
    for (let i = 0; i < lines.length; i++) {
      const normLine = normalizeForMatch(lines[i]);
      if (normLine.includes(normQuote) || normLine.includes(probe)) return i;
    }
  }

  // Pass B — token anchor: the line whose significant tokens the draft best
  // accounts for. Earliest line wins ties.
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineTokens = significantTokens(lines[i]);
    if (lineTokens.size < 3) continue;
    const score = tokenCoverage(lineTokens, needle);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return bestScore >= RECONSTRUCT_MATCH_THRESHOLD ? best : -1;
}

function bulletIndent(line: string): number | null {
  const m = line.match(BULLET_LINE);
  return m ? m[1].length : null;
}

/** Expand an anchor line to the verbatim block it belongs to: a bullet anchor
    grows to its top-level bullet plus every nested sub-bullet; a prose anchor
    (transcript lines) takes up to 2 following non-blank lines. */
function expandAnchor(lines: string[], anchor: number): string[] {
  const anchorIndent = bulletIndent(lines[anchor]);
  if (anchorIndent === null) {
    const out = [lines[anchor]];
    for (let i = anchor + 1; i < lines.length && out.length < 3; i++) {
      if (lines[i].trim().length === 0) break;
      out.push(lines[i]);
    }
    return out;
  }

  // Climb through contiguous bullet lines to the top-level bullet: any line
  // with a strictly smaller indent is a parent of everything seen so far.
  let top = anchor;
  let topIndent = anchorIndent;
  for (let i = anchor - 1; i >= 0; i--) {
    const indent = bulletIndent(lines[i]);
    if (indent === null || lines[i].trim().length === 0) break;
    if (indent < topIndent) {
      top = i;
      topIndent = indent;
    }
  }

  // The top bullet plus every following strictly-deeper sub-bullet; a blank
  // line, prose, or a sibling/parent-level bullet ends the block.
  const out = [lines[top]];
  for (let i = top + 1; i < lines.length; i++) {
    const indent = bulletIndent(lines[i]);
    if (indent === null || indent <= topIndent) break;
    out.push(lines[i]);
  }
  return out;
}

/**
 * Locate the note bullet / transcript lines a draft came from and return them
 * verbatim (≤1200 chars), or undefined when no line matches confidently.
 *
 * The model no longer emits sourceText (ModelExtractedTaskDraft omits it —
 * re-copying the transcript per task dominated generation latency); this
 * rebuilds it deterministically from the sourceQuote so the completeness and
 * misattribution passes keep their grounding. No anchor → undefined, and the
 * matching passes fall back to title + sourceQuote + checklist tokens.
 */
export function reconstructSourceText(
  draft: Pick<ExtractedTaskDraft, "title" | "sourceQuote" | "checklist">,
  ctx: ReconstructContext
): string | undefined {
  const needle = significantTokens(
    [draft.sourceQuote ?? "", draft.title, ...(draft.checklist ?? [])].join("\n")
  );
  for (const doc of [ctx.summary, ctx.transcript]) {
    if (!doc) continue;
    const lines = doc.split(/\r?\n/);
    const anchor = findAnchorLine(lines, draft.sourceQuote, needle);
    if (anchor === -1) continue;
    return expandAnchor(lines, anchor)
      .map((l) => l.trim())
      .join("\n")
      .slice(0, 1200);
  }
  return undefined;
}

/** Fill missing sourceText on every draft (items that already carry one —
    e.g. synthesized fallbacks — are kept as-is). Run between parsing and
    postProcessExtraction; see finalizeExtraction. */
export function reconstructAllSourceText(
  items: ExtractedTaskDraft[],
  ctx: ReconstructContext
): ExtractedTaskDraft[] {
  return items.map((item) =>
    item.sourceText ? item : { ...item, sourceText: reconstructSourceText(item, ctx) }
  );
}

// ── Matching ─────────────────────────────────────────────────────────────────

/** A task covers a bullet when at least this share of the bullet-head tokens
    appear in the task's text. Tuned to separate "same deliverable, different
    wording" (~0.5+) from "shares a product name" (~0.2). */
const BULLET_MATCH_THRESHOLD = 0.5;
/** A clause counts as preserved when this share of its tokens appear. */
const CLAUSE_KEEP_THRESHOLD = 0.6;
/** Title-similarity floor for merging two unmatched drafts. */
const TITLE_MERGE_JACCARD = 0.7;

function bestBulletIndex(
  taskTokens: Set<string>,
  bulletTokens: { head: Set<string>; raw: Set<string> }[]
): { index: number; score: number } {
  let index = -1;
  let score = 0;
  bulletTokens.forEach((b, i) => {
    // Symmetric-ish: how much of the task's grounding text lives in the
    // bullet, and how much of the bullet head the task mentions.
    const s = Math.max(tokenCoverage(taskTokens, b.raw), tokenCoverage(b.head, taskTokens));
    if (s > score) {
      score = s;
      index = i;
    }
  });
  return { index, score };
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// ── Merging / synthesis ──────────────────────────────────────────────────────

const CONFIDENCE_RANK = { high: 2, medium: 1, low: 0 } as const;

function mergeDrafts(base: ExtractedTaskDraft, extra: ExtractedTaskDraft): ExtractedTaskDraft {
  const seen = new Set(base.checklist.map((c) => c.toLowerCase()));
  const checklist = [
    ...base.checklist,
    ...extra.checklist.filter((c) => !seen.has(c.toLowerCase())),
  ].slice(0, 20);
  const depSeen = new Set(base.dependencies.map((d) => `${d.owner}|${d.requirement}`.toLowerCase()));
  const dependencies = [
    ...base.dependencies,
    ...extra.dependencies.filter((d) => !depSeen.has(`${d.owner}|${d.requirement}`.toLowerCase())),
  ].slice(0, 10);
  return {
    ...base,
    description:
      extra.description.length > base.description.length ? extra.description : base.description,
    checklist,
    dependencies,
    confidence:
      CONFIDENCE_RANK[extra.confidence] > CONFIDENCE_RANK[base.confidence]
        ? extra.confidence
        : base.confidence,
    sourceText: base.sourceText ?? extra.sourceText,
    sourceQuote: base.sourceQuote ?? extra.sourceQuote,
  };
}

function sentenceCase(text: string): string {
  const t = text.trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Build a reviewable fallback draft verbatim from an assigned bullet the
    model missed. Deliberately conservative: no inference beyond the bullet. */
function synthesizeDraft(bullet: AssignedBullet, owner: string): ExtractedTaskDraft {
  const title = sentenceCase(bullet.head).replace(/[.,;:\s]+$/, "").slice(0, 300);
  return {
    title: title.length >= 3 ? title : `Follow up: ${bullet.raw.slice(0, 280)}`,
    description: `From the meeting notes: "${bullet.raw.slice(0, 1500)}"`.slice(0, 2000),
    priority: "medium",
    type: "change",
    tags: [],
    owner,
    checklist: bullet.clauses.map((c) => sentenceCase(c).slice(0, 300)).slice(0, 20),
    dependencies: [],
    confidence: "medium",
    sourceQuote: bullet.raw.slice(0, 300),
    sourceText: bullet.raw.slice(0, 1200),
  };
}

// ── Main pipeline ────────────────────────────────────────────────────────────

export interface PostProcessOptions {
  /** The meeting notes/summary text (falls back to the transcript for pasted
      notes). Used to parse explicitly assigned bullets as ground truth. */
  notes: string | null | undefined;
  /** Names that mean "the builder" — display name, first name, etc. */
  builderAliases: string[];
}

export function postProcessExtraction(
  rawItems: ExtractedTaskDraft[],
  options: PostProcessOptions
): PostProcessResult {
  const repairs: ExtractionRepair[] = [];

  // 1. Normalize owners (tasks + their dependencies).
  const items: ExtractedTaskDraft[] = rawItems.map((item) => {
    const owner = normalizeOwner(item.owner, options.builderAliases);
    if (owner !== item.owner && item.owner !== undefined) {
      repairs.push({
        kind: "owner_normalized",
        detail: `"${item.owner}" → "${owner ?? "(unassigned)"}" on "${item.title}"`,
      });
    }
    return {
      ...item,
      owner,
      dependencies: item.dependencies.map((d) => ({
        ...d,
        owner: normalizeOwner(d.owner, options.builderAliases) ?? d.owner,
      })),
    };
  });

  // 2. Ground truth: explicitly assigned bullets from the notes.
  const bullets = parseAssignedBullets(options.notes);
  const bulletOwners = bullets.map(
    (b) => normalizeOwner(b.owner, options.builderAliases) ?? b.owner
  );
  const bulletTokens = bullets.map((b) => ({
    head: significantTokens(b.head),
    raw: significantTokens(b.raw),
  }));

  // 3. Trace each task back to its best source bullet.
  const matchedBullet = items.map((item) => {
    const { index, score } = bestBulletIndex(draftMatchTokens(item), bulletTokens);
    return score >= BULLET_MATCH_THRESHOLD ? index : -1;
  });

  // 4. Misattribution repair: the bullet's explicit assignee wins over the
  //    model's guess. Someone else's commitment never lands as builder work.
  items.forEach((item, i) => {
    const bi = matchedBullet[i];
    if (bi === -1) return;
    const trueOwner = bulletOwners[bi];
    const current = item.owner ?? "builder"; // absent = treated as builder downstream
    if (current !== trueOwner) {
      repairs.push({
        kind: "owner_reattributed",
        detail: `"${item.title}" reassigned ${current} → ${trueOwner} (notes assign it to ${bullets[bi].owner})`,
        sourceText: bullets[bi].raw,
      });
      items[i] = { ...item, owner: trueOwner };
    }
  });

  // 5. Conservative dedup. Merge only when two drafts describe the SAME
  //    deliverable: traced to the same source bullet, or (when untraced)
  //    near-identical titles. Tasks traced to DIFFERENT bullets never merge,
  //    however similar they sound.
  const merged: ExtractedTaskDraft[] = [];
  const mergedBullet: number[] = [];
  items.forEach((item, i) => {
    const bi = matchedBullet[i];
    const owner = item.owner ?? "builder";
    const dupIndex = merged.findIndex((existing, j) => {
      if ((existing.owner ?? "builder") !== owner) return false;
      if (bi !== -1 || mergedBullet[j] !== -1) return bi !== -1 && mergedBullet[j] === bi;
      return (
        jaccard(significantTokens(existing.title), significantTokens(item.title)) >=
        TITLE_MERGE_JACCARD
      );
    });
    if (dupIndex === -1) {
      merged.push(item);
      mergedBullet.push(bi);
    } else {
      repairs.push({
        kind: "duplicate_merged",
        detail: `"${item.title}" merged into "${merged[dupIndex].title}" (same deliverable)`,
      });
      merged[dupIndex] = mergeDrafts(merged[dupIndex], item);
    }
  });

  // 6. Completeness: every explicitly assigned bullet must be covered by a
  //    task with the right owner. Uncovered bullets become verbatim fallback
  //    drafts — an assigned action item is never silently dropped.
  bullets.forEach((bullet, bi) => {
    if (mergedBullet.includes(bi)) return;
    // Second chance on full text (incl. description) before synthesizing —
    // step 3 matched on grounding fields only.
    const fullMatch = merged.findIndex(
      (item, j) =>
        mergedBullet[j] === -1 &&
        (item.owner ?? "builder") === bulletOwners[bi] &&
        tokenCoverage(bulletTokens[bi].head, draftFullTokens(item)) >= BULLET_MATCH_THRESHOLD
    );
    if (fullMatch !== -1) {
      mergedBullet[fullMatch] = bi;
      return;
    }
    repairs.push({
      kind: "missing_task_synthesized",
      detail: `No extracted task covered the assigned item "${bullet.owner}: ${bullet.head}" — added from the notes verbatim`,
      sourceText: bullet.raw,
    });
    merged.push(synthesizeDraft(bullet, bulletOwners[bi]));
    mergedBullet.push(bi);
  });

  // 7. Requirement preservation: each clause of a covered bullet (nested
  //    sub-bullets, ";"-separated requirements, "then push it live") must be
  //    represented in the matched task, else it's appended to the checklist.
  merged.forEach((item, j) => {
    const bi = mergedBullet[j];
    if (bi === -1) return;
    const bullet = bullets[bi];
    const clauses = bullet.clauses.length > 0 ? bullet.clauses : [bullet.head];
    let taskTokens = draftContentTokens(item);
    const additions: string[] = [];
    for (const clause of clauses) {
      if (tokenCoverage(significantTokens(clause), taskTokens) >= CLAUSE_KEEP_THRESHOLD) continue;
      const entry = sentenceCase(clause).slice(0, 300);
      additions.push(entry);
      repairs.push({
        kind: "requirement_appended",
        detail: `"${item.title}" was missing the requirement "${clause}" — appended to its checklist`,
        sourceText: bullet.raw,
      });
      taskTokens = new Set([...taskTokens, ...significantTokens(clause)]);
    }
    if (additions.length > 0) {
      merged[j] = {
        ...item,
        checklist: [...item.checklist, ...additions].slice(0, 20),
        sourceText: item.sourceText ?? bullet.raw.slice(0, 1200),
      };
    }
  });

  // 8. Cap at the schema limit, dropping loudly rather than silently.
  let final = merged;
  if (merged.length > 40) {
    for (const dropped of merged.slice(40)) {
      repairs.push({
        kind: "item_dropped",
        detail: `Over the 40-draft cap — dropped "${dropped.title}"`,
        sourceText: dropped.sourceText,
      });
    }
    final = merged.slice(0, 40);
  }

  return { items: final, repairs };
}
