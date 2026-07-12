import "server-only";

import type OpenAI from "openai";
import { runChat, AI_MODEL } from "./client";
import type { AiCallMeta } from "./usage";
import { ExtractTasksResult, ExtractedTaskDraft, ModelExtractTasksResult } from "./schemas";
import { jsonResponseFormat, stripNullsDeep } from "./strict-schema";
import {
  postProcessExtraction,
  reconstructAllSourceText,
  type ExtractionRepair,
} from "./extract-tasks-postprocess";
import { TASK_TAGS } from "@/lib/types";

// The budget is shared between the reasoning pass and the output JSON: low
// effort typically burns ~1-3k reasoning tokens, and 40 drafts with trimmed
// descriptions + checklists (no sourceText — reconstructed server-side) is
// ~14k — 16k leaves headroom for both.
const MAX_TOKENS = 16_000;

// Keep the prompt well inside the context window; an 80k-char transcript is
// ~2-2.5h of talking, which covers any real call. When we must cut, keep the
// head (agenda, early asks) AND the tail (wrap-ups recap the action items) and
// drop the middle — a head-only cut silently loses the end-of-call recap.
const MAX_TRANSCRIPT_CHARS = 80_000;
const TAIL_CHARS = 30_000;

export interface ExtractTasksInput {
  noteTitle: string | null;
  summary: string | null;
  transcript: string; // normalized plain text ("Me: … / Them: …")
  participants: string | null; // raw <known_participants> text from Granola, if any
  /** The builder's display name, when known. Lets the model (and the
      post-processor) map "Steven: do X" notes onto owner "builder". */
  builderName?: string | null;
}

// The full extraction instruction block, kept BYTE-IDENTICAL across every call so
// it forms one large static prefix OpenAI can cache (prompt_cache_key:
// "granola-task-extraction-v1"). The ONLY per-builder text — the builder's identity
// — is appended AFTER this base in buildSystemPrompt, never spliced into it, so the
// shared cacheable prefix stays intact across calls (and across builders). The
// `${TASK_TAGS}` interpolation is a compile-time constant, so this whole string is
// still identical every request. Don't reintroduce a per-call value here or the
// cache hit shrinks.
const EXTRACTION_SYSTEM_BASE = [
  "You extract action items from a client-call transcript and its meeting notes for a solo software builder. Capture EVERY participant's explicitly assigned action items — the builder's own work AND commitments made by other participants (client-side homework, third-party follow-ups). Each task carries an owner; assignee filtering happens AFTER extraction, so never discard another person's task during extraction.",
  "",
  "Work through the call in three passes:",
  "1. If meeting notes / a summary are present, enumerate EVERY assigned action item in them and account for each one: each becomes exactly one task, or matches an exclusion. Notes almost always restate each commitment — an assigned note item you did not turn into a task is a defect. One bullet = one task: never fold two separately-listed items into one task just because they are similar, and never split one bullet into several tasks.",
  "2. Scan the transcript top to bottom and flag every commitment or request cue: builder commitments ('I'll…', 'I can…', 'let me…'), client asks ('can we…', 'could you…', 'we need…'), other participants' commitments ('Rahul said he'd…', 'I'll send you the list'), problem reports, and agreements even when tentative. Pay special attention to the wrap-up — action items are usually restated at the end.",
  "3. Merge duplicate MENTIONS of the same deliverable into one task (a task recapped at the end of the call is still one task), drop anything matching the exclusions, and turn the rest into tasks.",
  "",
  "Owner attribution — strict rules:",
  "- The builder is named in the 'Builder identity' note at the END of these instructions; when the notes or transcript assign work to the builder — by that name, its first name, or (when speakers are only labeled 'Me'/'Them') as 'Me' — set owner to exactly 'builder'.",
  "- Set owner to 'builder' ONLY when the notes or transcript explicitly assign the work to the builder, or the builder explicitly committed to it. Never assign work to the builder just because it sounds technical or plausible.",
  "- For work another participant committed to, set owner to that person's name as written ('Rahul', 'Kathleen'). Never invent a name.",
  "- Another person sending the builder a file, template, list, or link is THAT PERSON'S action item (owner = their name). If a builder task cannot proceed until it arrives, also record it in that builder task's `dependencies` — it is NOT a separate builder task.",
  "- If ownership is genuinely ambiguous, keep the task, OMIT owner, and set confidence to 'medium' or 'low' — never silently guess an owner.",
  "",
  "Do NOT create tasks for:",
  "- chit-chat, scheduling the next meeting, pleasantries",
  "- general discussion, context, or an implied next step nobody explicitly took on ('we should probably…' that was never assigned)",
  "- pure brainstorming with no ask behind it",
  "- duplicate mentions of the same deliverable (merge them into one task)",
  "",
  "For each task set:",
  "- title: short, imperative, specific to the deliverable ('Add CSV export to reports page'). The title is a label — it must never be the only place a requirement lives.",
  "- description: what and why, with the key context from the call, written as a bullet list of 3–6 concise bullet points, each on its own line starting with '• ' (bullets only, no intro or trailing paragraph). Preserve exact email addresses, dates, day counts, time windows, field names, status names, and quoted replacement copy VERBATIM — never paraphrase an exact value.",
  "- checklist: when an action item has multiple requirements or steps (nested bullets, ';'-separated clauses, 'X and Y', 'then push it live'), list EACH one as its own checklist entry, preserving exact values. Completion criteria like 'then push it live' are checklist entries. Single-step tasks get an empty checklist. Every nested sub-bullet of the source item MUST appear as a checklist entry.",
  "- dependencies: what another person must provide before this task can proceed, as {owner, requirement} (e.g. Rahul sending the template). Only real blockers stated on the call.",
  "- owner: per the attribution rules above",
  "- confidence: 'high' when explicitly assigned in plain terms; 'medium' when assignment or scope required interpretation; 'low' when you are unsure it was really agreed.",
  "- priority: urgency as expressed on the call (default 'medium' when unstated)",
  "- type: 'feature' (new capability), 'bug' (broken behavior), or 'change' (tweak to existing behavior)",
  `- tags: at most one of: ${TASK_TAGS.join(", ")}`,
  "- sourceQuote: a short verbatim excerpt (≤300 chars) that grounds the task — for a note bullet, the bullet's own line copied exactly",
  "",
  "Every task must be grounded in a specific moment of the call: copy sourceQuote verbatim. If no line of the transcript or notes supports a task, do not invent it.",
  "These drafts are reviewed before anything is created, so when something WAS explicitly assigned, err on the side of including it — a missed assigned task costs real work; an extra draft just gets unchecked. That leeway applies only to genuinely assigned items, never to unassigned discussion.",
  "Return at most 40 tasks; if the call somehow yields more, keep the 40 most concrete.",
  "If the call contains no action items at all, return an empty items array.",
  "Return JSON matching the provided schema exactly.",
].join("\n");

function buildSystemPrompt(input: ExtractTasksInput): string {
  // The ONE per-builder line — appended last so EXTRACTION_SYSTEM_BASE stays a
  // cacheable static prefix (see the note on the constant). Same instruction as
  // before, just moved out of the middle of the attribution rules.
  const builderIdentity = input.builderName
    ? `Builder identity: the builder's name is "${input.builderName}" — when the notes or transcript assign work to that name (or its first name), that IS the builder: set owner to exactly 'builder'.`
    : "Builder identity: no name was given — if speakers are only labeled 'Me'/'Them', 'Me' is the builder.";
  return `${EXTRACTION_SYSTEM_BASE}\n\n${builderIdentity}`;
}

function buildUserPrompt(input: ExtractTasksInput): string {
  const transcript =
    input.transcript.length > MAX_TRANSCRIPT_CHARS
      ? [
          input.transcript.slice(0, MAX_TRANSCRIPT_CHARS - TAIL_CHARS),
          "[… middle of transcript omitted …]",
          input.transcript.slice(-TAIL_CHARS),
        ].join("\n\n")
      : input.transcript;

  return [
    input.noteTitle ? `Call: ${input.noteTitle}` : null,
    input.participants ? `## Participants\n${input.participants}` : null,
    input.summary ? `## Meeting summary\n${input.summary}` : null,
    `## Transcript\n${transcript}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * The exact request params for a task extraction — shared by the blocking call
 * below and the SSE streaming route (app/api/ai/granola/extract-tasks/stream),
 * so the two paths can never drift on model, prompt, effort, or schema.
 */
export function buildExtractionParams(input: ExtractTasksInput) {
  return {
    model: AI_MODEL,
    max_completion_tokens: MAX_TOKENS,
    // Inherits the app-wide reasoning effort (OPENAI_REASONING_EFFORT, default
    // "low") via runChat/runChatStream — the deterministic post-process safety
    // net (completeness, misattribution repair) backstops the recall a deeper
    // pass would buy, at a fraction of the latency.
    // Steer OpenAI's automatic prompt cache: EXTRACTION_SYSTEM_BASE (the ~40-line
    // instruction block) is a large static prefix re-sent on every extraction, so a
    // stable key raises the cache-hit rate on that prefix — cutting TTFT with zero
    // quality change (caching never alters output). Shared by the blocking and
    // streaming paths since both build params here.
    prompt_cache_key: "granola-task-extraction-v1",
    response_format: jsonResponseFormat(ModelExtractTasksResult, "granola_task_extraction"),
    messages: [
      { role: "system", content: buildSystemPrompt(input) },
      { role: "user", content: buildUserPrompt(input) },
    ],
  } satisfies OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
}

/** Strict validation of a complete model response. Returns ALL owners' tasks —
    assignee filtering happens after extraction (filterDraftsByOwner /
    isBuilderOwnedDraft), never during parsing. */
export function parseExtractionResult(content: string): ExtractTasksResult {
  const parsed = ExtractTasksResult.safeParse(stripNullsDeep(JSON.parse(content)));
  if (!parsed.success) {
    throw new Error(`Task extraction returned malformed JSON: ${parsed.error.message}`);
  }
  return parsed.data;
}

/** Safer fallback parser: salvage every individually valid item from a
    response whose envelope failed strict validation, instead of dropping the
    whole batch. Throws only when nothing at all is recoverable. */
export function parseExtractionResultLenient(content: string): ExtractTasksResult {
  const raw = stripNullsDeep(JSON.parse(content)) as { items?: unknown };
  if (!Array.isArray(raw?.items)) throw new Error("Task extraction response has no items array.");
  const items: ExtractedTaskDraft[] = [];
  for (const candidate of raw.items.slice(0, 40)) {
    const parsed = ExtractedTaskDraft.safeParse(candidate);
    if (parsed.success) items.push(parsed.data);
  }
  if (items.length === 0) throw new Error("Task extraction returned no valid items.");
  return { items };
}

function logRepairs(repairs: ExtractionRepair[], meta?: AiCallMeta) {
  for (const repair of repairs) {
    console.warn(
      `[extract-tasks] ${repair.kind}: ${repair.detail}`,
      meta?.operation ? `(op=${meta.operation})` : "",
      repair.sourceText ? `source=${JSON.stringify(repair.sourceText.slice(0, 200))}` : ""
    );
  }
}

/**
 * Parse a complete model response, reconstruct each draft's sourceText from
 * its sourceQuote (the model no longer emits sourceText — see
 * ModelExtractedTaskDraft), and run the deterministic safety net
 * (owner normalization, misattribution repair, dedup, completeness against
 * every explicitly assigned note bullet, requirement preservation). Both the
 * blocking path and the streaming route's `done` pass go through here, so the
 * guarantees can't drift between delivery modes.
 */
export function finalizeExtraction(
  content: string,
  input: ExtractTasksInput,
  meta?: AiCallMeta
): ExtractTasksResult {
  let parsed: ExtractTasksResult;
  try {
    parsed = parseExtractionResult(content);
  } catch (strictError) {
    // Malformed output is salvaged, not silently dropped.
    parsed = parseExtractionResultLenient(content);
    console.warn(
      `[extract-tasks] strict parse failed, salvaged ${parsed.items.length} items leniently:`,
      strictError instanceof Error ? strictError.message : strictError
    );
  }
  const grounded = reconstructAllSourceText(parsed.items, {
    summary: input.summary,
    transcript: input.transcript,
  });
  const { items, repairs } = postProcessExtraction(grounded, {
    notes: input.summary || input.transcript,
    builderAliases: input.builderName ? [input.builderName] : [],
  });
  logRepairs(repairs, meta);
  return { items };
}

export async function extractTasksFromTranscript(
  input: ExtractTasksInput,
  meta?: AiCallMeta
): Promise<ExtractTasksResult> {
  const response = await runChat(buildExtractionParams(input), meta);
  try {
    return finalizeExtraction(response.choices[0]?.message?.content ?? "", input, meta);
  } catch (firstError) {
    // Even the lenient parser found nothing usable — retry the generation once
    // before surfacing an error (transient truncation/malformation recovery).
    console.warn("[extract-tasks] unusable response, retrying generation once:", firstError);
    const retry = await runChat(buildExtractionParams(input), meta);
    return finalizeExtraction(retry.choices[0]?.message?.content ?? "", input, meta);
  }
}
