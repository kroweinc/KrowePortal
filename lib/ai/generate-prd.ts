import { openai, runChat, AI_MODEL, AI_REASONING_EFFORT } from "./client";
import { recordAiUsage, type AiCallMeta } from "./usage";
import { PrdGenerationResult, PrdFinalResult, PrdQuestionsResult } from "./schemas";
import type { Question } from "./schemas";
import { jsonResponseFormat, stripNullsDeep } from "./strict-schema";
import { buildPrdPrompts, type PrdGenInput, type PrdAnswer } from "./prd-prompts";
import type { PrdContent } from "@/lib/types";

// The prompts themselves live in ./prd-prompts (no OpenAI client import, so the
// snapshot test can render them without a key). Re-exported here so every existing
// caller — the streaming route, the action, draft-core — keeps its import path.
export { buildPrdPrompts };
export type { PrdGenInput, PrdAnswer } from "./prd-prompts";

export type PrdGenResult =
  | { kind: "questions"; items: Question[] }
  | { kind: "prd"; content: PrdContent; contextSummary?: string };

/** The fixed free-text opener for the no-notes "deep context" intake (round 0).
    It never depends on prior context, so the server returns it directly — no AI
    call — and every later round is generated with this answer in hand. Built as a
    complete, valid Question so it bypasses the AI question schema entirely (which
    requires 2+ items per round). */
export const OPENER_QUESTION: Question = {
  id: "opener-idea",
  text: "In a sentence or two, what's your idea — what is the product and the main problem it solves?",
  options: [],
  inputType: "text",
  multiSelect: false,
};

async function callOpenAI(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  responseFormat: ReturnType<typeof jsonResponseFormat>,
  meta?: AiCallMeta
): Promise<string> {
  const response = await runChat(
    {
      model: AI_MODEL,
      max_completion_tokens: maxTokens,
      response_format: responseFormat,
      // Steer OpenAI's automatic prompt cache: the large static system prefix
      // (SECTIONS + rules) is identical across rounds, so a stable key raises the
      // cache-hit rate on the repeated prefix. Quality-neutral — caching never
      // changes output.
      prompt_cache_key: "prd-gen-v1",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    },
    meta
  );
  return response.choices[0]?.message?.content ?? "";
}

/** Same contract as callOpenAI, but routes through the Responses API with the
    hosted web_search tool so the model can ground its recommendations in current
    real-world info (e.g. how to connect an AI phone assistant to a phone line).
    Gated by OPENAI_ENABLE_WEB_SEARCH. Degrades gracefully: if the call errors
    (model/endpoint doesn't support the tool) or returns nothing, it falls back
    to the plain chat-completions path so reasoning-based recommendations still
    ship. Still emits a JSON object validated by the same Zod schema downstream.

    The fallback takes the ROUND'S response format, not a hardcoded json_object: the
    web_search call can only ask for plain JSON mode, so when it fails the chat retry is
    the only chance to apply the round's strict schema. Hardcoding json_object here
    silently dropped the floor's questions-only constraint on every research-path round,
    leaving a forced-question round free to answer with a PRD (which then failed
    validation and degraded to the generic fallback questions). */
async function callOpenAIWithResearch(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  fallbackFormat: ReturnType<typeof jsonResponseFormat>,
  meta?: AiCallMeta
): Promise<string> {
  try {
    const response = await openai.responses.create({
      model: AI_MODEL,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      tools: [{ type: "web_search" }],
      text: { format: { type: "json_object" } },
      max_output_tokens: maxTokens,
      ...(AI_REASONING_EFFORT ? { reasoning: { effort: AI_REASONING_EFFORT } } : {}),
    });
    // The Responses API reports usage as input/output tokens — map onto the
    // shared prompt/completion ledger shape.
    if (meta && response.usage) {
      void recordAiUsage(meta, AI_MODEL, {
        prompt_tokens: response.usage.input_tokens,
        completion_tokens: response.usage.output_tokens,
        total_tokens: response.usage.total_tokens,
      });
    }
    const out = response.output_text ?? "";
    if (out.trim()) return out;
    return await callOpenAI(systemPrompt, userPrompt, maxTokens, fallbackFormat, meta);
  } catch (err) {
    console.warn("[generatePrd] web_search research call failed; falling back to chat completions", err);
    return await callOpenAI(systemPrompt, userPrompt, maxTokens, fallbackFormat, meta);
  }
}

// Output-token cap for PRD generations. gpt-5.x is a REASONING model: its reasoning
// tokens and the visible JSON share ONE output budget, and max_completion_tokens is
// what bounds the reasoning pass so the request actually terminates. Omitting it
// entirely (true "uncapped") leaves the model with no ceiling — on the heavy rounds
// it reasons without end and the request never returns, so the wizard hangs in
// "loading" forever. So we keep a GENEROUS finite ceiling instead: 32000 is ~4-6x a
// real PRD's output (a full document is ~4-8k tokens), so it never truncates a real
// PRD, while still guaranteeing the model stops. The empty-draft guard + final-round
// retry catch any rare truncation regardless. Set OPENAI_PRD_MAX_TOKENS to a positive
// integer to tune the ceiling without a code change.
export const PRD_MAX_TOKENS: number = (() => {
  const raw = (process.env.OPENAI_PRD_MAX_TOKENS ?? "").trim();
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 32000;
})();

/** The round's shape decision — the only two inputs that pick a schema. */
type RoundShape = Pick<PrdGenInput, "forceFinal" | "mustAsk">;

/** Strict json_schema whenever the round's shape is pinned in ONE direction: a finished
    PRD on the final round, questions on a floor round. Only the free rounds — where the
    model legitimately chooses between the two — fall back to json_object, since a root
    discriminated union is illegal in strict mode. */
export function prdResponseFormat(round: RoundShape): ReturnType<typeof jsonResponseFormat> {
  if (round.forceFinal) return jsonResponseFormat(PrdFinalResult, "prd_document");
  if (round.mustAsk) return jsonResponseFormat(PrdQuestionsResult, "prd_questions");
  return { type: "json_object" };
}

function roundSchema(round: RoundShape) {
  if (round.forceFinal) return PrdFinalResult;
  if (round.mustAsk) return PrdQuestionsResult;
  return PrdGenerationResult;
}

/** `skippable` is a SERVER-only affordance — only the built-in fallback round sets it, so
    the wizard's Skip control appears only where we put it. The floor round's strict schema
    is the first time the field is visible to the model, so drop whatever it sends: a model
    handing out Skip buttons on the very rounds that exist to stop it from skipping the
    interview would quietly undo the floor. */
function stripModelSkippable(items: Question[]): Question[] {
  return items.map(({ skippable: _skippable, ...q }) => q);
}

/** The section keys that identify a bare PRD content object — a few load-bearing
    ones, so a stray object with an "overview" string alone is never mistaken for a
    document. */
const PRD_CONTENT_KEYS = ["overview", "goals", "users", "features", "coreUserFlow", "successCriteria"];

function looksLikePrdContent(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return PRD_CONTENT_KEYS.filter((k) => obj[k] !== undefined).length >= 2;
}

/** Restore the { "kind": … } envelope when the model dropped it.
    A FREE round (neither forced-final nor a floor round) can only ask for plain
    json_object — a root discriminated union is illegal in strict mode — so nothing
    but the prompt keeps the model wrapping its answer. Verified live: when it decides
    to finalize, it returns the bare content object (top-level "overview", "goals",
    "features", …) about half the time, and that complete ~20k-character PRD was then
    discarded for the missing wrapper key, degrading the builder to fallback questions.
    Re-wrap only what is unmistakably one shape or the other; anything else passes
    through untouched for safeParse to reject. This never loosens a round's
    constraints — the rewrapped object still has to satisfy that round's schema, so a
    bare PRD on a floor round still fails, as it must. */
function normalizeEnvelope(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parsed;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.kind === "string") return obj;
  if (Array.isArray(obj.items)) return { kind: "questions", items: obj.items };
  const content = looksLikePrdContent(obj.content) ? obj.content : obj;
  if (!looksLikePrdContent(content)) return obj;
  return {
    kind: "prd",
    content,
    ...(typeof obj.contextSummary === "string" ? { contextSummary: obj.contextSummary } : {}),
  };
}

/** Non-throwing parse: validates a raw generation response against the round's
    schema and shapes it into the wizard result, or returns null when the model
    output can't be parsed/validated (truncation, drift outside the strict Question
    bounds, bad discriminator). Lets callers decide whether to retry or degrade. */
function tryParsePrdResult(raw: string, round: RoundShape): PrdGenResult | null {
  const schema = roundSchema(round);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    parsed = {};
  }

  const result = schema.safeParse(normalizeEnvelope(stripNullsDeep(parsed)));
  if (!result.success) return null;

  const data = result.data;
  if (data.kind === "questions") {
    return { kind: "questions", items: stripModelSkippable(data.items) };
  }
  return { kind: "prd", content: data.content as PrdContent, contextSummary: data.contextSummary };
}

/** A schema-valid, generic question round used when the model's interview output
    can't be parsed even after a retry. Keeps the wizard moving (especially the
    no-notes "deep context" path, where blank context makes the model most prone
    to drift outside the strict Question schema) instead of dead-ending the builder
    on "AI response validation failed".

    It MUST NOT re-ask what's already on record. The fallback only ever runs on a
    LATER round — round 0 serves the fixed OPENER_QUESTION directly and never hits
    this path — so the product/idea is already captured (by the opener in deep mode,
    or the builder's notes in standard mode). It asks only the two things still worth
    capturing late — the EXACT go-live date and the hard constraints. The go-live
    question is a dedicated DATE input (inputType "date", no options) so the builder
    types a precise MM/DD/YYYY — mirroring the date question the model asks on the
    normal interview path — and that exact date flows straight into
    constraintsDetail.deadline and the back-planned milestoneList when the PRD
    finalizes. It is marked skippable so a builder with no fixed date yet is never
    blocked. The constraints question stays a pick-list; the wizard auto-appends an
    "Other" option to every choice question, so it's always-answerable. Both never
    block regardless of which round fires them.

    It deliberately does NOT include an open-ended "anything about scope/users/
    features we missed?" catch-all. The fallback can fire on more than one round
    (blank deep-context context makes the model most prone to drift outside the
    strict Question schema), and a vague catch-all gets re-shown verbatim each time —
    so the builder saw the same "anything we haven't covered?" question early, skipped
    it, then hit it again later. It captured nothing concrete and only added friction,
    so it's gone; the two specific questions below are the whole fallback. */
function fallbackQuestionResult(): PrdGenResult {
  return {
    kind: "questions",
    items: [
      {
        id: "fallback-golive",
        text: "What is the client's exact target go-live date?",
        // Empty options + inputType "date" → the wizard renders the masked
        // MM/DD/YYYY field (same as the model's date question), so the builder
        // types a precise calendar date that back-plans the milestone timeline.
        options: [],
        inputType: "date",
        multiSelect: false,
        // Skippable: the degraded fallback must never block a builder who has no
        // fixed date yet — when they do type one it lands as MM/DD/YYYY and feeds
        // constraintsDetail.deadline + the back-planned milestoneList.
        skippable: true,
      },
      {
        id: "fallback-constraints",
        text: "Are there any hard constraints we need to design around? (Select all that apply)",
        options: [
          "Budget ceiling we must stay under",
          "Specific branding / design requirements",
          "Security or compliance requirements",
          "No hard constraints",
        ],
        inputType: "choice",
        multiSelect: true,
      },
    ],
  };
}

/** A resolved go-live date answer is a bare US calendar date (MM/DD/YYYY) — the
    only shape the wizard's date input produces (whether the builder picked a
    timeframe preset or typed an exact date). No other question type yields that
    exact string, so a bare US date among the prior answers is the reliable signal
    that the exact go-live date is already on record. */
const US_DATE_RE = /^\d{2}\/\d{2}\/\d{4}$/;

function hasDateAnswer(priorAnswers?: PrdAnswer[]): boolean {
  return !!priorAnswers?.some((a) => US_DATE_RE.test(a.answer.trim()));
}

/** Normalize a question's text for verbatim-repeat comparison: trim, lowercase, and
    collapse internal whitespace. Deliberately conservative — it matches only exact
    re-asks (the fixed fallback questions re-served across rounds, or a model
    copy-paste), never rephrasings, so genuinely distinct questions are never
    collapsed. */
function normalizeQuestionText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Drop questions the builder has effectively already handled, so the interview never
    re-asks something it already captured (the prompt calls re-asking "a failure";
    this enforces it server-side). Two rules:
    1. Date questions: the prompt requests the exact go-live date EVERY round and the
       staged "security" step names it again, so a round can repeat it (across two
       rounds, or twice within one). A PRD needs exactly ONE go-live date — keep at
       most the FIRST date question, and drop every date question once a date
       (MM/DD/YYYY) is already on record.
    2. Any other question whose normalized text matches one already answered in a prior
       round, or one already kept earlier in THIS round, is a verbatim repeat — drop
       it. The canonical case is the fixed `fallback-constraints` question being
       re-served on a later degraded round, which is what made the builder answer the
       same "hard constraints" question twice.
    May return an EMPTY array when every question was already handled (e.g. a second
    fallback round whose date + constraints are both answered). Callers finalize the
    PRD in that case rather than re-showing answered questions. */
export function dedupeQuestions(items: Question[], priorAnswers?: PrdAnswer[]): Question[] {
  const dateAnswered = hasDateAnswer(priorAnswers);
  const answeredText = new Set((priorAnswers ?? []).map((a) => normalizeQuestionText(a.question)));
  const seenThisRound = new Set<string>();
  let keptDate = false;
  return items.filter((q) => {
    if (q.inputType === "date") {
      if (dateAnswered || keptDate) return false;
      keptDate = true;
      return true;
    }
    const key = normalizeQuestionText(q.text);
    if (answeredText.has(key) || seenThisRound.has(key)) return false;
    seenThisRound.add(key);
    return true;
  });
}

/** Parse a raw generation response into the wizard result shape, degrading rather
    than throwing on a validation failure: a forced-final failure becomes an empty
    editable draft, and a question-round failure becomes a generic (schema-valid)
    question set so the interview never dead-ends. Both are warn-logged. Shared by
    the blocking action and the streaming route. */
export function parsePrdResult(raw: string, round: RoundShape): PrdGenResult {
  const parsed = tryParsePrdResult(raw, round);
  if (parsed) return parsed;

  if (round.forceFinal) {
    console.warn("[generatePrd] schema validation failed; returning empty PRD draft");
    return { kind: "prd", content: {} };
  }
  console.warn("[generatePrd] question-round validation failed; returning fallback questions");
  return fallbackQuestionResult();
}

export async function generatePrd(input: PrdGenInput, meta?: AiCallMeta): Promise<PrdGenResult> {
  const { systemPrompt, userPrompt } = buildPrdPrompts(input);

  // When OPENAI_ENABLE_WEB_SEARCH is on, ground recommendations in live web
  // research (json_object, with graceful fallback); otherwise use the plain chat
  // call with strict structured outputs on the final round.
  const useResearch = process.env.OPENAI_ENABLE_WEB_SEARCH === "true";
  const responseFormat = prdResponseFormat(input);
  const callOnce = () =>
    useResearch
      ? callOpenAIWithResearch(systemPrompt, userPrompt, PRD_MAX_TOKENS, responseFormat, meta)
      : callOpenAI(systemPrompt, userPrompt, PRD_MAX_TOKENS, responseFormat, meta);

  const raw = await callOnce();
  let result = tryParsePrdResult(raw, input);

  // A failed parse is usually transient and worth one retry before degrading:
  //  - a question round drifting outside the strict Question schema (the round
  //    uses plain json_object, not a json_schema), which the model self-corrects;
  //  - a forced-final round whose JSON was TRUNCATED mid-document (the reasoning
  //    pass + a deep PRD overran the token budget). That truncation is exactly
  //    what produced the silent empty-draft fallback, so retrying the final round
  //    too — rather than degrading straight to a blank PRD — is worth the second
  //    generation. Both retry against the same (now headroom-bumped) cap.
  //  - a floor round that finalized anyway. The strict questions-only schema makes
  //    that unreachable on the normal path, but the web_search path can only send
  //    json_object, so a PRD there simply fails to validate — and the retry (then the
  //    fallback questions below) keeps the floor intact rather than letting it through.
  if (!result) {
    result = tryParsePrdResult(await callOnce(), input);
  }

  // Still unparseable: degrade gracefully (empty draft / fallback questions) via
  // the shared, non-throwing parse path rather than surfacing a hard error.
  if (!result) result = parsePrdResult(raw, input);

  if (result.kind !== "questions") return result;

  // Drop questions already answered in a prior round (or repeated within this round)
  // so the interview never re-asks them — notably the fixed fallback questions, which
  // can be re-served on a later degraded round. If that leaves nothing new to ask,
  // there is no question round left to run: finalize the PRD instead of returning an
  // empty round. This is the one way out of a floor round — everything the round could
  // have asked is already answered, so holding the builder there would only re-show
  // answered questions. forceFinal is strict-schema-constrained and resolves only to a
  // "prd" result (and clears mustAsk, which it outranks anyway), so this cannot recurse.
  const items = dedupeQuestions(result.items, input.answers);
  if (items.length === 0) return generatePrd({ ...input, forceFinal: true, mustAsk: false }, meta);
  return { kind: "questions", items };
}
