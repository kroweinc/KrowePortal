import { openai, runChat, AI_MODEL, AI_REASONING_EFFORT } from "./client";
import { recordAiUsage, type AiCallMeta } from "./usage";
import { PrdGenerationResult, PrdFinalResult } from "./schemas";
import type { Question } from "./schemas";
import { jsonResponseFormat, stripNullsDeep } from "./strict-schema";
import { SCOPE_STAGE_COUNT, scopeStageAt } from "@/lib/prd/scope-stages";
import type { PrdContent } from "@/lib/types";

export type PrdAnswer = { question: string; answer: string };

export type PrdGenInput = {
  title: string;
  notes?: string;
  businessContext?: string;
  answers?: PrdAnswer[];
  /** When true, the model must return a finished PRD and may NOT ask more questions. */
  forceFinal: boolean;
  /** No written notes were given — run the staged scope intake and emit a contextSummary. */
  deepContext?: boolean;
  /** Deep mode only: which fixed scope stage this round covers (0-based; maps to SCOPE_STAGES). */
  stageIndex?: number;
  /** Today's date as an ISO calendar date (YYYY-MM-DD). Anchors the back-planned timeline. */
  currentDate: string;
};

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

const SECTIONS = `The PRD uses these JSON keys. Write for a small-business owner who must recognize THEIR product — be specific and concrete, never generic. A shallow, one-line-per-section PRD is a FAILURE; aim for the depth of a polished, client-ready document.

1. overview (string) — a RICH multi-sentence NARRATIVE paragraph (4–8 sentences), NOT a one-liner. In prose, cover: the problem/context the client faces; what the product IS in plain terms; who it is for; what THIS version focuses on; and the explicit scope boundary of this version (state plainly what is left out, e.g. "Business owners and referrers will not have accounts, dashboards, or admin access in this version.").

2. goals (string[]) AND successMetrics (string[]) — goals are full-sentence outcomes/capabilities the finished product gives the client, AND should include an explicit statement of what this version will NOT do. successMetrics are adoption/usage signals (usage, response-time, conversion); include them only when genuinely knowable — otherwise keep them sparse, since successCriteria below is the acceptance test.

3. users (array of { role, description, authLevel, permissions[] }) — break the audience into NAMED sub-groups (e.g. "Primary User — Admin", "Secondary Users — Referrers", "End Customers"). Give each a one–two sentence "description". For the primary/operating user, fill "permissions" with a concrete capability list ("Receive referral notifications by email", "View all submitted referrals", "Track referral status", "Manage referral records"). Passive groups may have an empty permissions list.

4. coreUserFlow (string[]) — ONE end-to-end, numbered walkthrough of the WHOLE product as a sequence of single-action steps, in order, from first touch to the final state. Aim for 7–12 steps. Do NOT number the strings yourself (the app numbers them). Each step is one concrete action or system response, e.g. "A referrer visits the public referral form", "The system generates a unique referral code", "The owner receives an email notification with the referral details".

5. features (array of { title, description, priority, details[], examples[] }) — the features, each a DEEP mini-spec. "description" = a few sentences on what it does and why. "details" = the enumerated specifics: every form field, every email's contents, every table column, every status value, every admin action — list them out. "examples" = ILLUSTRATIVE sample values clearly understood as examples (e.g. sample category options "Home insurance", "Auto insurance", "Roofing", "Other"; sample code formats "REF-1024", "R-8K29", "LOCAL-314"). priority is one of "must" | "should" | "could".

6. requirements (string[]) — cross-cutting functional requirements not tied to a single feature.

7. pagesScreens (array of { name, description, displays[] }) — every page/screen in this version. "displays" lists what that page shows or lets the user do (e.g. Public Referral Form Page → the form fields and a submit button; Thank-You Page → confirmation message and the generated code; Admin Dashboard → the referral table, status controls, filters).

8. successCriteria (string[]) — a TESTABLE acceptance CHECKLIST: each item is a binary, verifiable statement of done ("A referrer can submit the form successfully", "The system generates a unique code per submission", "The owner receives an email for each new referral", "Submissions are stored", "Only the owner can access the dashboard", "Statuses can be set to New, Contacted, or Converted", "The system is deployed and reachable"). Distinct from successMetrics.

9. nonFunctionalRequirements (string[]) — non-feature qualities: load time/performance, how it's set up/hosted, security, reliability, accessibility.

10. scopeLater (string[]) — features explicitly EXCLUDED from THIS version (the "not included in this build" list). Be generous and explicit — a long, honest exclusion list builds trust.

11. futureExpansion (string[]) — post-MVP upgrade opportunities the client could add later (the "could be added later as a paid upgrade" menu). Aspirational; distinct from scopeLater.

12. dataModel (array of { data, direction, source }) — what data is stored/imported/exported and where it comes from. direction is one of "import" | "export" | "both".

13. integrations (array of { name, purpose, monthlyCost, estimated, domain }) — every recommended 3rd-party software, what it's for, and the PRODUCT'S OWN subscription rate per month (NOT setup time or developer fees). Set "domain" to the software's official website host as a bare domain (no protocol/path), used to show its brand logo — e.g. Stripe → "stripe.com", Twilio → "twilio.com". Use null only if genuinely unknown.

14. techStack (array of { name, category, provider, layer, includes[], monthlyCost, estimated, domain }) — the concrete named stack, BROKEN DOWN BY LAYER. Set "layer" to one of "frontend" | "backend" | "database" | "email" | "hosting" | "other". Use "includes" to list what that layer covers (e.g. Frontend → "Public referral form", "Thank-you page", "Admin dashboard UI"; Database → "Stores referral submissions", "Stores generated codes", "Stores status"). Set "domain" to the technology's official website host as a bare domain (no protocol/path), used to show its brand logo — e.g. Next.js → "nextjs.org", Vercel → "vercel.com", PostgreSQL → "postgresql.org". Use null only if genuinely unknown. Right-size to the product — see the stack-scoping rules below.

15. uxFlows (array of { role, steps }) — per-role journeys as an ordered list of short single-action "steps" (about 5–8 each) that SUPPLEMENT (do not replace) the single coreUserFlow above. Each step is one concise sentence; do NOT number them yourself. Optional when coreUserFlow already covers the journey.

16. assumptions (string[]) — what the client must provide within a reasonable timeframe for the build to proceed.

17. constraintsDetail (object { deadline, budget, branding, security }) — hard constraints. The "deadline" MUST be the client's exact target launch / go-live DATE as a real US calendar date in MM/DD/YYYY format whenever it is known — capture the precise date during the interview, never a vague phrase like "before Q3" or "8 weeks out". Other fields may be omitted if truly unknown. NOTE: a project PRICE and PAYMENT TERMS belong to the separate quote, NOT the PRD — never put a build price or payment schedule anywhere in the PRD.

18. risks (string[]) AND openQuestions (string[]) AND milestoneList (array of { label, dueDate }) — risks are things that could cause delay. openQuestions MUST be EMPTY in a finished PRD (ask during the interview instead). milestoneList is the delivery TIMELINE: the ordered phases of work, each with a dueDate. When the client's exact deadline date is known, BACK-PLAN the schedule across the window from today's date (given in the notes) up to that deadline — distribute the milestones so the FINAL milestone's dueDate equals the exact deadline date and earlier milestones land on sensible intermediate calendar dates in between. Every dueDate must then be a real US calendar date in MM/DD/YYYY format, in chronological order. Only fall back to a rough phase label ("Week 2") when no exact deadline date is known. ALSO set milestoneDueDate to the single overall deadline the whole timeline builds toward, in MM/DD/YYYY format — it MUST equal the final milestone's dueDate.`;

const COST_RULES = `Cost rules for sections 8 and 9:
- monthlyCost is the third party's / provider's own published subscription rate per month, phrased like "~$25/mo" or "$0/mo + 2.9% per txn". It is NEVER the developer's fee or setup time.
- ONE provider's subscription is billed ONCE even when it spans several stack items/layers. When the SAME platform appears as multiple entries (e.g. Supabase used for both Auth and Postgres, or Firebase for Auth + Firestore + Storage), that is ONE plan, not one per layer. Put the platform's monthly plan price on a SINGLE representative item and set every other same-platform item's monthlyCost to "$0/mo (incl.)". NEVER repeat the full plan price on each layer — that double-counts a single subscription and overstates the bill.
- You MAY fill monthlyCost from typical published rates you know, but set "estimated": true on that item so it is flagged for the builder to verify.
- If you don't know a price, ASK the builder to confirm it during the interview. Only when you are finalizing without an answer, fill a clearly-marked estimate (estimated: true) — never leave the price as an open question in the finished PRD.`;

const STACK_RULES = `Tech stack right-sizing (section 9 + any tech-stack question you ask):
- Match the stack to the product's actual scope and complexity. First judge the scale from the notes — roughly: simple (a landing page, brochure site, form, or small CRUD tool), standard (a typical web app with auth, a database, and a few integrations), or complex (real-time, heavy data/ML, high scale, multi-service, or strict compliance).
- Recommend the SIMPLEST stack that fully delivers the requirements. Do not reach for heavyweight or enterprise frameworks (e.g. Ruby on Rails, Django, Spring, Kubernetes, microservices, a dedicated message queue, Kafka) unless the requirements genuinely need them. Prefer lightweight, low-cost, low-maintenance choices for simple/standard products (e.g. a static site or a single Next.js app with a managed database and managed hosting).
- When you ASK a tech-stack question, the options you offer must all be appropriate for the inferred scope. For a lightweight product, every option should be a lightweight choice — never offer a complex framework as one of the options for a simple product, and never anchor the builder toward over-engineering.
- Favor managed/serverless and free or low tiers when traffic and data are modest; only introduce more infrastructure as specific requirements (scale, real-time, compliance, offline, etc.) justify it. If a heavier choice IS warranted, say briefly why in the item's name/category context.
- Avoid redundant or overlapping tools (e.g. don't list two databases or two hosting providers) unless the product clearly needs both.`;

const CONDITIONAL_RULES = `Depth and examples:
- The interview's job is to gather everything needed to fill ALL sections. If a section can't be filled responsibly yet, ASK about it during the interview rather than leaving it blank or deferring it.
- WRITE RICH, CONCRETE CONTENT. Shallow, generic PRDs are a failure. Overview, goals, and user descriptions must be full narrative prose; features must be deep mini-specs with their fields/columns/statuses enumerated in "details".
- You ARE allowed and ENCOURAGED to include ILLUSTRATIVE EXAMPLES to make the document vivid: sample dropdown options, example field lists, sample ID/code formats, example statuses. Put these in each feature's "examples" array (or phrase them inline as "for example…"). Frame them clearly as illustrations, not commitments.
- The line you must NOT cross: do not fabricate CLIENT-SPECIFIC FACTS as if confirmed — e.g. the client's real vendor, their actual negotiated prices, real customer data, a real deadline, or a chosen tool the builder hasn't agreed to. Mark any price you supply from general knowledge with "estimated": true. If a real, load-bearing fact is unknown, ASK for it in the interview; do not invent it.
- In short: invent EXAMPLES freely (and label them as examples); never invent confirmed FACTS.
- When the business context contains a "SOP / Discovery Call Transcript", treat it as the verbatim raw discovery source. MINE it for concrete facts (the problem, users, scope, constraints, deadline, named tools) and do NOT re-ask in the interview what the transcript already answers. Synthesize those facts into the PRD's own prose — never copy transcript passages verbatim into PRD fields.
- Never include a project price or payment terms anywhere in the PRD — those live in the separate quote.
- The finished PRD must contain NO open questions — every unknown should have been resolved by asking. If you are forced to finalize and a minor detail is still unknown, make a sensible, clearly-stated assumption and record it under "assumptions" (e.g. "Assumes Stripe for payments unless told otherwise"). Leave openQuestions empty.`;

// Whose words define the product. The project's saved "Business context" is
// carried over from earlier work on the same client and is frequently STALE — it
// can describe a DIFFERENT or earlier product than the one being specified now
// (e.g. a prior CRM PRD's synthesized summary bleeding into a new chatbot PRD).
// Without this rule the model treats that context as ground truth, overrides the
// builder's actual stated idea, finds "nothing left to ask", and finalizes the
// wrong product. The builder's current notes + answers MUST win on any conflict.
const SCOPE_AUTHORITY = `Scope authority — whose words define the product (READ FIRST):
- The builder's notes and their ANSWERS to your questions in THIS interview are the AUTHORITATIVE definition of the product to spec. Build EXACTLY the product they describe, in their own words.
- The "Business context" block is background that may have been carried over from EARLIER work on this client. It can be STALE or describe a DIFFERENT or earlier product than the one the builder is specifying now. Trust it ONLY where it is CONSISTENT with the builder's stated idea/answers (e.g. the client's name, industry, prior hard constraints).
- When the business context CONFLICTS with the builder's stated idea or answers — e.g. the context describes a lead CRM but the builder said the product is "an AI chatbot" — the BUILDER'S CURRENT ANSWERS WIN. Spec the product they actually described; do NOT silently substitute the product the business context describes, and do NOT add an assumption claiming the builder's stated idea "was not the intended scope." If the saved context describes a different product, treat it as NOT APPLICABLE and disregard it entirely for scope, users, features, and data.`;

function buildStagedBlock(stageIndex: number): string {
  const stage = scopeStageAt(stageIndex);
  const stepNum = Math.min(Math.max(stageIndex, 0), SCOPE_STAGE_COUNT - 1) + 1;
  return `

Staged scope interview — you are running a FIXED step-by-step intake, ONE step per round. The builder already told you their idea in their own words (it is the FIRST answer above) — treat that idea as the ANCHOR and make every question SPECIFIC to it (its product type, domain, and users), never generic. This idea answer OUTRANKS any saved "Business context": if that context describes a different product, IGNORE it and build this interview around the idea answer. This round is STEP ${stepNum} of ${SCOPE_STAGE_COUNT}: "${stage.label}". Ask ONLY about: ${stage.focus}. Do NOT jump ahead to later steps' topics — keep every question in this round on this step. Return 2–4 questions for this step (this overrides the 2–5 guidance above).`;
}

function buildSystemPrompt(forceFinal: boolean, deepContext = false, stageIndex?: number): string {
  // Deep "no-context" mode always asks the model to synthesize a reusable
  // business-context narrative when it finalizes the PRD (both the staged
  // question rounds and the forced final share this).
  const contextSummaryBlock = deepContext
    ? `

No-context mode (the builder provided NO written notes): whenever you return the finished PRD (kind:"prd"), ALSO include a top-level "contextSummary" — a concise 1–2 paragraph business-context narrative (what the business does, the problem being solved, who the users are, and the goal) synthesized from the answers, written so it can be saved and reused as the starting context for future documents about this client.`
    : "";

  // `base` is deliberately kept BYTE-IDENTICAL across every round (deep or not,
  // final or interview) so it forms one large static prefix OpenAI can cache
  // (prompt_cache_key: "prd-gen-v1"). All round-varying text — the deep-mode
  // contextSummary instruction, the forceFinal/interview clauses, the staged block
  // — is appended AFTER base, never spliced into it. Don't reintroduce a volatile
  // value here or the shared prefix (and its cache hit) shrinks.
  const base = `You are drafting an OUTBOUND Product Requirements Document (PRD) for a prospective software product, working from a builder's notes about a client they are pitching, plus answers the builder gave to your clarifying questions. The builder refines it and sends it to the prospect to align on scope before any contract. There is no existing codebase.

Voice: clear, concrete, non-technical where possible. A small-business owner should recognize their own product. No marketing fluff.

${SCOPE_AUTHORITY}

${SECTIONS}

${COST_RULES}

${STACK_RULES}

${CONDITIONAL_RULES}

Output ONLY valid JSON.`;

  // While still interviewing in deep mode, drive the fixed step-by-step scope
  // backbone (idea → users → flows → security) — appended last so its per-step
  // focus overrides the generic interview guidance.
  const staged = deepContext && stageIndex != null ? buildStagedBlock(stageIndex) : "";

  if (forceFinal) {
    return `${base}${contextSummaryBlock}

You have reached the question limit. Return a finished PRD now:
{ "kind": "prd", "content": { ...the full section object... } }
Fill every section from the notes + answers, with rich, concrete content. Do NOT ask any more questions, and do NOT leave any open questions — for anything still unknown, state a sensible assumption under "assumptions" and keep openQuestions empty. If an exact deadline date was provided, set constraintsDetail.deadline to that date in MM/DD/YYYY format, set milestoneDueDate to that date in MM/DD/YYYY format, and back-plan milestoneList so the final milestone's dueDate equals it and every dueDate is a real calendar date in MM/DD/YYYY format.`;
  }

  return `${base}${contextSummaryBlock}

Your goal is to interview the builder until you can fill EVERY section richly with NO open questions remaining.
- BEFORE asking anything, mine the business context (especially any "SOP / Discovery Call Transcript"), the builder's notes, and the answers so far for facts already stated — but only facts about the SAME product the builder is specifying now (see "Scope authority" above). If the saved business context describes a DIFFERENT product than the builder's stated idea, DISREGARD it for scope and interview around the stated idea as if there were no prior context. NEVER ask a question whose answer is already given (in matching context, the notes, or the answers) or can be reasonably inferred from it — treat it as known and write it straight into the PRD. Re-asking something discovery already captured is a failure. Example: if the SOP says "mainly me, the front desk, and our instructors — I'd want admin access and instructors should add notes and update cases," the staff roles ARE established → do NOT ask "which staff roles should have accounts." When a topic is only PARTIALLY answered, ask ONLY about the missing slice (e.g. the front desk's exact permissions), never the part already answered.
- If ANY section still has a GENUINE unknown (not answered by the SOP/notes/answers), ask about it. Return 2–5 concrete multiple-choice questions per round that close the remaining gaps (each offers 3–5 options, ranked most→least likely; the builder can also type their own):
  { "kind": "questions", "items": [ { "id": "q1", "text": "…", "options": ["…","…","…"], "multiSelect": false, "recommended": "…", "recommendation": "Best for you because …" } ] }
  (Omit "inputType" on normal pick-list questions — it defaults to "choice". Use "inputType": "date" only for the exact go-live date question described below.)
- For EACH question, set "multiSelect": true when the builder could legitimately choose more than one option (e.g. which integrations are needed, which data sources feed the product, which user roles exist, which platforms to support). Set "multiSelect": false for single-answer questions (e.g. the primary deadline, the main budget tier, the single most important goal). Always include the multiSelect field.
- For EACH question, mark exactly ONE option as recommended: set "recommended" to that option's exact text (character-for-character one of the strings in "options"), and set "recommendation" to one short, plain-language sentence telling a non-technical builder WHY it is the best default for THIS product (tie it to their notes/answers — not generic advice). Choose the option you genuinely judge best, not always the first. For technical/implementation questions (e.g. how to connect an AI phone assistant to a phone line, which auth method, which hosting), reason about the best real-world method and recommend a concrete, proven default. For multi-select questions, set "recommended" to the single option most worth including. Omit both fields only if no option is meaningfully better than the others.
- You MUST capture the client's EXACT target launch / go-live DATE before finalizing — it drives the entire delivery timeline. Ask for it as a dedicated DATE question so the builder types the precise calendar date: set "inputType": "date", "multiSelect": false, and "options": [] (the builder gets an MM/DD/YYYY input — do NOT offer timeframe options for this one). Example: { "id": "qN", "text": "What is the client's exact target go-live date?", "inputType": "date", "multiSelect": false, "options": [] }. Do not finalize the PRD with only a vague deadline if you have not yet asked for the exact date.
- Only return the finished PRD once every section can be filled from the notes + answers and you have NO questions left to ask:
  { "kind": "prd", "content": { ...the full section object, openQuestions empty... } }
Prioritize questions that unlock DEPTH on what is still genuinely unknown after mining the SOP / notes / answers — especially: the named user groups and their permissions (§3); the per-feature specifics needed to write mini-specs (the exact form fields, table columns, email contents, and status values for §5); the pages/screens (§7); data/integrations/tech stack (§12–14); and hard constraints (§17). Ask for the concrete specifics that let you write deep feature mini-specs rather than guessing them as facts. Prefer asking over guessing.${staged}`;
}

function buildUserPrompt(input: PrdGenInput): string {
  const lines: string[] = [];
  lines.push(`PRD title: ${input.title}`);
  lines.push(`Today's date: ${input.currentDate} (use this to back-plan the timeline and compute milestone calendar dates).`);
  if (input.businessContext) lines.push(`Business context: ${input.businessContext}`);
  lines.push("");
  lines.push("Builder notes:");
  lines.push(input.notes && input.notes.trim().length > 0 ? input.notes.trim() : "(none provided)");

  if (input.answers && input.answers.length > 0) {
    lines.push("");
    lines.push("Answers to your clarifying questions so far:");
    for (const a of input.answers) {
      lines.push(`Q: ${a.question}`);
      lines.push(`A: ${a.answer}`);
    }
  }
  return lines.join("\n");
}

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
    ship. Still emits a JSON object validated by the same Zod schema downstream. */
async function callOpenAIWithResearch(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
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
    return await callOpenAI(systemPrompt, userPrompt, maxTokens, { type: "json_object" }, meta);
  } catch (err) {
    console.warn("[generatePrd] web_search research call failed; falling back to chat completions", err);
    return await callOpenAI(systemPrompt, userPrompt, maxTokens, { type: "json_object" }, meta);
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

/** The system + user prompts for a generation round. Shared by the blocking
    generatePrd and the streaming route handler. */
export function buildPrdPrompts(input: PrdGenInput): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: buildSystemPrompt(input.forceFinal, input.deepContext, input.stageIndex),
    userPrompt: buildUserPrompt(input),
  };
}

/** Strict json_schema on the single-object final PRD; json_object on the question
    round (root discriminated union, illegal for strict). */
export function prdResponseFormat(forceFinal: boolean): ReturnType<typeof jsonResponseFormat> {
  return forceFinal ? jsonResponseFormat(PrdFinalResult, "prd_document") : { type: "json_object" };
}

/** Non-throwing parse: validates a raw generation response against the round's
    schema and shapes it into the wizard result, or returns null when the model
    output can't be parsed/validated (truncation, drift outside the strict Question
    bounds, bad discriminator). Lets callers decide whether to retry or degrade. */
function tryParsePrdResult(raw: string, forceFinal: boolean): PrdGenResult | null {
  const schema = forceFinal ? PrdFinalResult : PrdGenerationResult;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    parsed = {};
  }

  const result = schema.safeParse(stripNullsDeep(parsed));
  if (!result.success) return null;

  const data = result.data;
  if (data.kind === "questions") {
    return { kind: "questions", items: data.items };
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
export function parsePrdResult(raw: string, forceFinal: boolean): PrdGenResult {
  const parsed = tryParsePrdResult(raw, forceFinal);
  if (parsed) return parsed;

  if (forceFinal) {
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
  const callOnce = () =>
    useResearch
      ? callOpenAIWithResearch(systemPrompt, userPrompt, PRD_MAX_TOKENS, meta)
      : callOpenAI(systemPrompt, userPrompt, PRD_MAX_TOKENS, prdResponseFormat(input.forceFinal), meta);

  const raw = await callOnce();
  let result = tryParsePrdResult(raw, input.forceFinal);

  // A failed parse is usually transient and worth one retry before degrading:
  //  - a question round drifting outside the strict Question schema (the round
  //    uses plain json_object, not a json_schema), which the model self-corrects;
  //  - a forced-final round whose JSON was TRUNCATED mid-document (the reasoning
  //    pass + a deep PRD overran the token budget). That truncation is exactly
  //    what produced the silent empty-draft fallback, so retrying the final round
  //    too — rather than degrading straight to a blank PRD — is worth the second
  //    generation. Both retry against the same (now headroom-bumped) cap.
  if (!result) {
    result = tryParsePrdResult(await callOnce(), input.forceFinal);
  }

  // Still unparseable: degrade gracefully (empty draft / fallback questions) via
  // the shared, non-throwing parse path rather than surfacing a hard error.
  if (!result) result = parsePrdResult(raw, input.forceFinal);

  if (result.kind !== "questions") return result;

  // Drop questions already answered in a prior round (or repeated within this round)
  // so the interview never re-asks them — notably the fixed fallback questions, which
  // can be re-served on a later degraded round. If that leaves nothing new to ask,
  // there is no question round left to run: finalize the PRD instead of returning an
  // empty round. forceFinal is strict-schema-constrained and resolves only to a "prd"
  // result, so this cannot recurse.
  const items = dedupeQuestions(result.items, input.answers);
  if (items.length === 0) return generatePrd({ ...input, forceFinal: true }, meta);
  return { kind: "questions", items };
}
