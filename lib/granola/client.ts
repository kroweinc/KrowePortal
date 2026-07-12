import "server-only";

// Typed wrapper around Granola's MCP server (https://mcp.granola.ai/mcp),
// called with a per-user OAuth access token — see lib/granola/oauth.ts and
// lib/granola/connection.ts. The exported surface is unchanged from the old
// REST wrapper so the import actions are agnostic to the transport.
//
// Tool shapes verified live (scripts/granola-mcp-discovery.ts, Jul 2026):
// - list_meetings only takes time_range ("this_week"|"last_week"|"last_30_days")
//   — no cursor/limit — and returns ONE page for the whole range, so pagination
//   degrades to a single page (hasMore: false).
// - list_meetings / get_meetings return XML-ish text: <meetings_data …>
//   <meeting id="…" title="…" date="Jul 1, 2026 9:00 AM CDT">
//   <known_participants>…</known_participants><summary>markdown</summary>
//   </meeting>…  (summary only present on get_meetings).
// - get_meeting_transcript on free workspaces returns isError with
//   "Transcripts are only available to paid Granola tiers".
// - list_meeting_folders (verified Jul 2026) is plan-gated the same way:
//   free workspaces get isError "Meeting folders are only available to paid
//   Granola tiers". Its success payload shape is unverified from a free
//   account, so parseFolders reads both JSON and XML-ish shapes defensively.
//   list_meetings additionally accepts an optional folder_id filter.
// - get_account_info returns JSON text {email, active_workspace}.

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  callGranolaTool,
  callGranolaToolsInSession,
  toolResultPayload,
  toolErrorText,
  GranolaMcpAuthError,
  GranolaMcpRateLimitError,
} from "@/lib/granola/mcp";

const MAX_429_RETRIES = 2;
const RETRY_FALLBACK_MS = [1_500, 3_000];

/** 401/403 — the stored token was revoked or is invalid. */
export class GranolaAuthError extends Error {
  constructor() {
    super("Granola rejected the connection.");
    this.name = "GranolaAuthError";
  }
}

/** The note doesn't exist yet (still processing) or was deleted. */
export class GranolaNotFoundError extends Error {
  constructor() {
    super("Granola note not found — it may still be processing.");
    this.name = "GranolaNotFoundError";
  }
}

/** 429 that persisted through retries. */
export class GranolaRateLimitError extends Error {
  constructor() {
    super("Granola rate limit exceeded.");
    this.name = "GranolaRateLimitError";
  }
}

export interface GranolaNote {
  id: string;
  title: string | null;
  created_at: string | null;
  summary: string | null;
  participants: string | null;
}

export interface GranolaTranscriptSegment {
  text: string;
  speaker?: {
    source?: "microphone" | "speaker";
    diarization_label?: string;
  } | null;
}

export interface GranolaNotesPage {
  notes: GranolaNote[];
  hasMore: boolean;
  cursor: string | null;
}

export interface GranolaFolder {
  id: string;
  title: string;
  noteCount: number | null;
}

export interface GranolaNoteDetail {
  note: GranolaNote;
  transcript: GranolaTranscriptSegment[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Per-result classification shared by the single-call and batched paths.
    "rate-limited" is separated out (rather than thrown) so the caller's retry
    loop can re-run the whole attempt with the usual backoff. */
type ToolOutcome =
  | { kind: "ok"; payload: unknown }
  | { kind: "rate-limited" }
  | { kind: "error"; error: Error };

function classifyToolResult(name: string, result: CallToolResult): ToolOutcome {
  if (!result.isError) return { kind: "ok", payload: toolResultPayload(result) };
  const text = toolErrorText(result).toLowerCase();
  if (text.includes("not found") || text.includes("no meeting")) {
    return { kind: "error", error: new GranolaNotFoundError() };
  }
  if (text.includes("unauthorized") || text.includes("invalid token") || text.includes("expired token")) {
    return { kind: "error", error: new GranolaAuthError() };
  }
  if (text.includes("rate limit")) return { kind: "rate-limited" };
  return {
    kind: "error",
    error: new Error(`Granola tool ${name} failed: ${toolErrorText(result).slice(0, 200)}`),
  };
}

/**
 * One tool call with the same 429 patience the REST wrapper had, mapping
 * transport/tool failures onto the exported error classes.
 */
async function granolaTool(
  accessToken: string,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    let result: CallToolResult;
    try {
      result = await callGranolaTool(accessToken, name, args);
    } catch (err) {
      if (err instanceof GranolaMcpAuthError) throw new GranolaAuthError();
      if (!(err instanceof GranolaMcpRateLimitError)) throw err;
      if (attempt >= MAX_429_RETRIES) throw new GranolaRateLimitError();
      await sleep(RETRY_FALLBACK_MS[attempt]);
      continue;
    }

    const outcome = classifyToolResult(name, result);
    if (outcome.kind === "rate-limited") {
      if (attempt >= MAX_429_RETRIES) throw new GranolaRateLimitError();
      await sleep(RETRY_FALLBACK_MS[attempt]);
      continue;
    }
    if (outcome.kind === "error") throw outcome.error;
    return outcome.payload;
  }
}

// ── <meetings_data> parsing ──────────────────────────────────────────────

interface MeetingBlock {
  attrs: Record<string, string>;
  body: string;
}

// Attribute values are double-quoted and may contain ">" verbatim (e.g.
// title="Steven <> Patel"), so consume quoted strings — never [^>]*.
const MEETING_BLOCK_RE = /<meeting\s+((?:\w+="[^"]*"\s*)+)>([\s\S]*?)<\/meeting>/g;
const ATTR_RE = /(\w+)="([^"]*)"/g;
const SUMMARY_RE = /<summary>\s*([\s\S]*?)\s*<\/summary>/;
const PARTICIPANTS_RE = /<known_participants>\s*([\s\S]*?)\s*<\/known_participants>/;

function parseMeetingBlocks(payload: unknown): MeetingBlock[] {
  if (typeof payload !== "string") return [];
  const blocks: MeetingBlock[] = [];
  for (const match of payload.matchAll(MEETING_BLOCK_RE)) {
    const attrs: Record<string, string> = {};
    for (const attr of match[1].matchAll(ATTR_RE)) attrs[attr[1]] = attr[2];
    blocks.push({ attrs, body: match[2] });
  }
  return blocks;
}

/** "Jul 1, 2026 9:00 AM CDT" → ISO string (V8 parses the TZ abbreviation). */
function toIsoDate(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function blockToNote(block: MeetingBlock): GranolaNote {
  return {
    id: block.attrs.id ?? "",
    title: block.attrs.title?.trim() || null,
    created_at: toIsoDate(block.attrs.date),
    summary: SUMMARY_RE.exec(block.body)?.[1]?.trim() || null,
    // Raw inner text, unstructured on purpose — its only consumer is the task
    // extraction prompt, so the LLM reads whatever shape Granola emits.
    participants: PARTICIPANTS_RE.exec(block.body)?.[1]?.trim() || null,
  };
}

export async function listNotes(
  accessToken: string,
  // cursor/pageSize kept for call-site compatibility: the MCP tool has no
  // cursor/page size, so the whole range comes back as one page.
  opts: { cursor?: string; pageSize?: number; createdAfter?: string; folderId?: string } = {}
): Promise<GranolaNotesPage> {
  const args: Record<string, unknown> = { time_range: "last_30_days" };
  if (opts.folderId) args.folder_id = opts.folderId;
  const payload = await granolaTool(accessToken, "list_meetings", args);
  return {
    notes: parseMeetingBlocks(payload).map(blockToNote).filter((n) => n.id),
    hasMore: false,
    cursor: null,
  };
}

// ── folders ──────────────────────────────────────────────────────────────

// Paid-tier payload shape is unverifiable from a free account (the tool is
// plan-gated), so accept either a JSON list ({folders: […]} or bare array,
// id/title-or-name/note_count fields) or XML-ish <folder …> tags.
const FOLDER_TAG_RE = /<folder\s+((?:\w+="[^"]*"\s*)+)\/?>/g;

function toFolder(raw: unknown): GranolaFolder | null {
  const rec = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const id = typeof rec.id === "string" ? rec.id : "";
  const title =
    typeof rec.title === "string" && rec.title.trim()
      ? rec.title.trim()
      : typeof rec.name === "string" && rec.name.trim()
        ? rec.name.trim()
        : "";
  if (!id || !title) return null;
  const count = rec.note_count ?? rec.noteCount ?? rec.count;
  const parsed = typeof count === "number" ? count : typeof count === "string" ? Number(count) : NaN;
  return { id, title, noteCount: Number.isFinite(parsed) ? parsed : null };
}

function parseFolders(payload: unknown): GranolaFolder[] {
  if (typeof payload === "string") {
    const folders: GranolaFolder[] = [];
    for (const match of payload.matchAll(FOLDER_TAG_RE)) {
      const attrs: Record<string, string> = {};
      for (const attr of match[1].matchAll(ATTR_RE)) attrs[attr[1]] = attr[2];
      const folder = toFolder(attrs);
      if (folder) folders.push(folder);
    }
    return folders;
  }
  const list = Array.isArray(payload)
    ? payload
    : ((payload as Record<string, unknown>)?.folders as unknown[] | undefined) ?? [];
  return (Array.isArray(list) ? list : [])
    .map(toFolder)
    .filter((f): f is GranolaFolder => f !== null);
}

/**
 * Folders for the import dialog's filter row. Plan-gated on free workspaces —
 * that (and any unparseable payload) degrades to [] so the UI simply hides
 * the filter instead of erroring.
 */
export async function listFolders(accessToken: string): Promise<GranolaFolder[]> {
  try {
    const payload = await granolaTool(accessToken, "list_meeting_folders", {});
    return parseFolders(payload);
  } catch (err) {
    if (err instanceof GranolaAuthError || err instanceof GranolaRateLimitError) throw err;
    if (isPlanDenial(err)) return [];
    throw err;
  }
}

/** Plan-gated transcript access should degrade, not throw. Live free-tier
    wording: "Transcripts are only available to paid Granola tiers". */
function isPlanDenial(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : "";
  return (
    message.includes("paid") ||
    message.includes("tier") ||
    message.includes("plan") ||
    message.includes("upgrade")
  );
}

// The transcript shape on paid workspaces isn't verifiable from a free
// account: accept plain text (single unlabeled segment) or a JSON segment
// array, reading fields defensively.
function toSegment(raw: unknown): GranolaTranscriptSegment {
  const seg = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const speaker = seg.speaker;
  const text = typeof seg.text === "string" ? seg.text : typeof seg.content === "string" ? seg.content : "";
  return {
    text,
    speaker:
      typeof speaker === "string"
        ? { diarization_label: speaker }
        : ((speaker ?? null) as GranolaTranscriptSegment["speaker"]),
  };
}

function parseTranscriptPayload(payload: unknown): GranolaTranscriptSegment[] {
  if (typeof payload === "string") {
    return payload.trim() ? [{ text: payload.trim(), speaker: null }] : [];
  }
  const segments = Array.isArray(payload)
    ? payload
    : ((payload as Record<string, unknown>)?.transcript as unknown[] | undefined) ?? [];
  return (Array.isArray(segments) ? segments : [])
    .map(toSegment)
    .filter((s) => s.text.trim().length > 0);
}

export async function getNoteWithTranscript(
  accessToken: string,
  noteId: string
): Promise<GranolaNoteDetail> {
  // The detail and transcript calls are independent by note id, so they run
  // concurrently over ONE session — one connect/handshake instead of two full
  // sequential session cycles. A 429 (transport- or tool-level, either call)
  // retries the whole attempt with the usual backoff.
  const calls = [
    { name: "get_meetings", args: { meeting_ids: [noteId] } },
    { name: "get_meeting_transcript", args: { meeting_id: noteId } },
  ];

  for (let attempt = 0; ; attempt++) {
    let results: CallToolResult[];
    try {
      results = await callGranolaToolsInSession(accessToken, calls);
    } catch (err) {
      if (err instanceof GranolaMcpAuthError) throw new GranolaAuthError();
      if (!(err instanceof GranolaMcpRateLimitError)) throw err;
      if (attempt >= MAX_429_RETRIES) throw new GranolaRateLimitError();
      await sleep(RETRY_FALLBACK_MS[attempt]);
      continue;
    }

    const detailOutcome = classifyToolResult(calls[0].name, results[0]);
    const transcriptOutcome = classifyToolResult(calls[1].name, results[1]);
    if (detailOutcome.kind === "rate-limited" || transcriptOutcome.kind === "rate-limited") {
      if (attempt >= MAX_429_RETRIES) throw new GranolaRateLimitError();
      await sleep(RETRY_FALLBACK_MS[attempt]);
      continue;
    }

    // Meeting detail is load-bearing (title/summary feed the prompt) — its
    // failure stays fatal.
    if (detailOutcome.kind === "error") throw detailOutcome.error;
    const block = parseMeetingBlocks(detailOutcome.payload)[0];
    // An unknown/still-processing id comes back as an empty meetings_data set.
    if (!block) throw new GranolaNotFoundError();
    const note = blockToNote(block);
    if (!note.id) note.id = noteId;

    let transcript: GranolaTranscriptSegment[] = [];
    if (transcriptOutcome.kind === "ok") {
      transcript = parseTranscriptPayload(transcriptOutcome.payload);
    } else if (
      !(transcriptOutcome.error instanceof GranolaNotFoundError) &&
      !isPlanDenial(transcriptOutcome.error)
    ) {
      throw transcriptOutcome.error;
    }
    // else: no transcript (still processing, or free workspace) — the import
    // actions fall back to summary-only content and error only when both
    // are empty.

    return { note, transcript };
  }
}

/** Connected-account label for the settings page, captured at connect time. */
export async function getAccountInfo(accessToken: string): Promise<{ email: string | null }> {
  const payload = await granolaTool(accessToken, "get_account_info", {});
  const record = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  return { email: typeof record.email === "string" ? record.email : null };
}

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
 * a speaker prefix.
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
