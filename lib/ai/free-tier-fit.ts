import { runChat, AI_MODEL } from "./client";
import type { AiCallMeta } from "./usage";
import { FreeTierAnalysisResult } from "./schemas";
import type { FreeTierAnalysis, FreeTierAssumption } from "./schemas";
import { jsonResponseFormat, stripNullsDeep } from "./strict-schema";
import type { PrdContent } from "@/lib/types";

/* Free-Tier Fit (PRD §15). Given the PRD's qualitative scope (users, features,
   data model) plus its tech stack and integrations, infer the product's likely
   usage and decide, per external SaaS, whether it can run on the provider's FREE
   tier — and which dimension forces the first paid upgrade. The app captures no
   measured usage, so the model INFERS it from scope and must state every number
   it assumed in `assumptions[]`. Every verdict is a published-rate ESTIMATE the
   builder must verify (estimated: true), mirroring the §8/§9 cost convention. */

// On a second validation failure, hand back a safe shell rather than throwing —
// the action turns an empty `services` array into a friendly error.
const EMPTY: FreeTierAnalysis = {
  overallFitsFree: "risky",
  primaryLimitingFactor: null,
  totalMonthlyCostIfPaid: null,
  assumptions: [],
  services: [],
  analyzedAt: null,
};

async function callJson(
  system: string,
  user: string,
  responseFormat: ReturnType<typeof jsonResponseFormat>,
  meta?: AiCallMeta
): Promise<string> {
  const res = await runChat({
    model: AI_MODEL,
    max_completion_tokens: 3000,
    response_format: responseFormat,
    // The ~1.5k-token system prompt (free-tier limits + rules) is fully static and
    // re-sent on every check — a stable key lets OpenAI cache that prefix.
    prompt_cache_key: "free-tier-fit-v1",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  }, meta);
  return res.choices[0]?.message?.content || "{}";
}

function clamp(s: string | null | undefined, max: number): string {
  return (s ?? "").trim().slice(0, max);
}

/** Normalized, de-duped stack + integration names declared in the PRD. The action
    snapshots this onto the analysis so the UI can detect a genuinely changed stack
    (added / removed / renamed service) — independent of the concrete providers the
    model infers from abstract entries like "Managed hosting". Must stay in sync with
    the client's currentServiceNames() normalization (trim + lowercase). */
export function stackServiceNames(content: PrdContent): string[] {
  const names = [
    ...(content.techStack ?? []).map((s) => s.name),
    ...(content.integrations ?? []).map((s) => s.name),
  ];
  return Array.from(new Set(names.map((n) => (n ?? "").trim().toLowerCase()).filter(Boolean)));
}

// Compact the PRD into just the dimensions that drive usage volume — not the
// whole document. Keeps the prompt cheap and focused on what scales.
function buildScopeDigest(content: PrdContent): string {
  const parts: string[] = [];

  const overview = clamp(content.overview, 800);
  if (overview) parts.push(`OVERVIEW:\n${overview}`);

  const users = content.users ?? [];
  if (users.length) {
    parts.push(
      "USER ROLES (infer MAU / seats from these):\n" +
        users
          .map((u) => `- ${clamp(u.role, 120)}${u.authLevel ? ` [${clamp(u.authLevel, 80)}]` : ""}: ${clamp(u.description, 200)}`)
          .join("\n")
    );
  }

  const features = content.features ?? [];
  if (features.length) {
    parts.push(
      "FEATURES (infer requests / compute / emails / storage from these):\n" +
        features
          .map((f) => {
            const detail = (f.details ?? []).slice(0, 3).map((d) => clamp(d, 120)).filter(Boolean).join("; ");
            return `- ${clamp(f.title, 200)}${f.priority ? ` (${f.priority})` : ""}${detail ? ` — ${detail}` : ""}`;
          })
          .join("\n")
    );
  }

  const data = content.dataModel ?? [];
  if (data.length) {
    parts.push(
      "DATA MODEL (infer DB rows / storage / bandwidth from these):\n" +
        data.map((d) => `- ${clamp(d.data, 200)}${d.direction ? ` [${d.direction}]` : ""}${d.source ? ` from ${clamp(d.source, 120)}` : ""}`).join("\n")
    );
  }

  const integrations = content.integrations ?? [];
  if (integrations.length) {
    parts.push(
      "INTEGRATIONS / 3RD-PARTY SOFTWARE (evaluate each):\n" +
        integrations.map((i) => `- ${clamp(i.name, 120)}${i.purpose ? ` — ${clamp(i.purpose, 200)}` : ""}`).join("\n")
    );
  }

  const stack = content.techStack ?? [];
  if (stack.length) {
    parts.push(
      "TECH STACK & INFRASTRUCTURE (evaluate each external/hosted service):\n" +
        stack
          .map((s) => `- ${clamp(s.name, 120)}${s.layer ? ` [${s.layer}]` : ""}${s.provider ? ` (${clamp(s.provider, 120)})` : ""}`)
          .join("\n")
    );
  }

  return parts.join("\n\n");
}

// Web-verified free-tier limits (see VERIFIED date below). The model otherwise
// recalls these from training and gets them wrong — it had claimed Resend allows
// 100 emails/MONTH when it's actually 3,000/month with a 100/DAY cap. Injected as
// authoritative ground truth so verdicts compare usage against real caps, not
// the model's stale memory (critical now that the stack defaults to a small model).
// Re-verify periodically; see memory: provider-free-tier-limits.
const KNOWN_LIMITS_VERIFIED = "June 2026";
const KNOWN_FREE_TIER_LIMITS = `- Resend: 3,000 emails/month with a HARD 100/day cap; 1 verified domain. The 100/day cap usually binds before the monthly total.
- Vercel (Hobby): 100 GB fast data transfer/mo, 1,000,000 function invocations/mo, 4 hrs Active CPU/mo, 1 GB Blob storage. No overage billing — the feature pauses until the 30-day window resets.
- Supabase (Free): 500 MB database (project goes READ-ONLY past 500 MB), 1 GB file storage, 50,000 monthly active users, 5 GB egress. Project pauses after 1 week of inactivity; max 2 active projects.
- Stripe: NO free "tier" and no monthly fee — pay-per-transaction at 2.9% + $0.30 (US cards). Treat as hasFreeTier=true, fitsFree="yes", limitingFactor=null; note the per-transaction fee in freeTierSummary.
- Clerk (Free): 50,000 monthly active users; unlimited applications. Pro ~$25/mo above that.
- Firebase (Spark / Firestore): 1 GB stored, 50,000 reads/day, 20,000 writes/day, 20,000 deletes/day. Daily quotas reset each day.`;

function buildSystemPrompt(currentDate: string): string {
  return `You assess whether each external SaaS / hosted service in a software product's stack can run on its provider's FREE tier given the product's LIKELY usage, and you identify the single dimension that would force an upgrade off free. Today is ${currentDate}.

Return ONLY this JSON shape:
{
  "overallFitsFree": "yes" | "risky" | "no",
  "primaryLimitingFactor": string|null,
  "totalMonthlyCostIfPaid": string|null,
  "assumptions": [ { "label": string, "value": string } ],
  "services": [
    {
      "name": string,
      "provider": string|null,
      "hasFreeTier": boolean,
      "fitsFree": "yes" | "risky" | "no",
      "freeTierSummary": string|null,
      "estimatedUsage": string|null,
      "limitingFactor": string|null,
      "recommendedPaidTier": string|null,
      "estimated": true
    }
  ]
}

WHICH SERVICES: emit one entry per real, billable hosted service in the stack/integrations (e.g. Vercel, Supabase, Firebase, Neon, Stripe, Resend, SendGrid, Cloudflare, AWS S3, Clerk, Auth0). SKIP pure open-source libraries/frameworks with no hosted bill of their own (e.g. React, Tailwind, shadcn/ui, Zod) — they cost nothing to run.

USAGE INFERENCE (critical — there are NO measured usage numbers): infer expected usage from the scope. User roles → monthly active users / seats. Features + data model → DB rows & storage, API requests, function invocations, outbound emails, bandwidth, build minutes.

Express EVERY usage figure your verdicts depend on as a {label, value} stat in "assumptions" — these are the editable knobs the builder corrects and re-runs, so each must be ONE concrete driver, never a sentence:
- "label" = the metric, e.g. "Monthly active users", "Referrals / month", "Transactions / day", "Stored data", "Emails / month", "DB rows".
- "value" = the assumed figure on its own, e.g. "~5,000", "~1,000/mo", "~100/day", "~2 GB".
Surface the 3–8 numbers that actually move a verdict, biggest cost drivers first. If the builder supplied scale numbers (in the user message), treat them as AUTHORITATIVE: use those EXACT figures, recompute every verdict against them, and echo each provided stat back in "assumptions" unchanged (then add any extra drivers you still had to assume).

PER-DIMENSION GUIDANCE — check the cap that actually binds each service type:
- Auth / hosting platforms: monthly active users / seats, function invocations, build minutes, bandwidth.
- Managed Postgres / serverless DB (Supabase, Neon, Firebase): database size, row/document count, monthly active rows, connection limits, and project pausing after inactivity.
- Object storage / CDN: stored GB + egress bandwidth.
- Email APIs (Resend, SendGrid): emails per day/month, verified domains.
- Usage-priced-but-free-to-start (Stripe): no monthly free "tier" floor — set hasFreeTier=true, fitsFree="yes", limitingFactor=null; note the per-transaction fee in freeTierSummary rather than treating it as an upgrade trigger.

KNOWN FREE-TIER LIMITS (AUTHORITATIVE — web-verified ${KNOWN_LIMITS_VERIFIED}). For the providers below, use these EXACT caps as the limit side of every verdict, IN PLACE OF your own recollection (which is frequently stale). Compare the builder's stated usage against THESE caps — do not invent different limits. Echo the specific cap you used into "freeTierSummary". For any provider NOT listed here, fall back to your best knowledge of its current published free tier and lean conservative.
${KNOWN_FREE_TIER_LIMITS}

VERDICT RULES:
- "yes": comfortably within the free limits at the inferred usage.
- "risky": plausibly exceeds one dimension within ~year 1, or you are genuinely uncertain.
- "no": exceeds a free limit at launch, OR the provider has no free tier (hasFreeTier=false ⇒ fitsFree="no").
- Always fill "limitingFactor" for "risky" and "no". Put the concrete free-tier limits you reasoned against in "freeTierSummary" so the builder can verify them.
- "recommendedPaidTier": the next tier up and its monthly rate (e.g. "Pro — ~$25/mo") for "risky"/"no"; null when it fits free.

ROLLUP:
- "overallFitsFree" = the worst case across all services.
- "primaryLimitingFactor" = the single binding constraint — the first / most-likely service+dimension to break free (e.g. "Supabase database storage once submissions exceed ~500MB").
- "totalMonthlyCostIfPaid" = the summed minimum monthly cost if every non-fitting service moves to its recommended paid tier. ONLY the price range — a bare money string like "~$25–45/mo" or "$70/mo", with NO explanatory words, caveats, or "excluding…" clauses appended. null if everything fits free.

TRUST: every figure is an ESTIMATE from published free-tier limits you know — state them but they must be verified; never present the client's real usage as fact. Set "estimated": true on every service. Output valid JSON only.`;
}

// Builder-edited stats survive a round-trip as objects, but a legacy cached
// analysis may still hold plain strings — keep only well-formed {label, value}.
function cleanAssumptions(raw?: FreeTierAssumption[]): FreeTierAssumption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is FreeTierAssumption => !!a && typeof a === "object")
    .map((a) => ({ label: (a.label ?? "").trim(), value: (a.value ?? "").trim() }))
    .filter((a) => a.label && a.value);
}

function buildUserPrompt(content: PrdContent, scaleHint?: string, priorAssumptions?: FreeTierAssumption[]): string {
  const stats = cleanAssumptions(priorAssumptions);
  const statBlock = stats.length
    ? `\n\nBUILDER-PROVIDED ASSUMPTIONS (authoritative — use these EXACT figures, recompute every verdict against them, and echo each back in "assumptions" unchanged):\n${stats.map((a) => `- ${a.label}: ${a.value}`).join("\n")}`
    : "";

  const hint = (scaleHint ?? "").trim();
  const hintLine = hint
    ? `\n\nADDITIONAL SCALE CONTEXT (authoritative):\n${hint.slice(0, 1000)}`
    : "";

  return `Assess the free-tier fit for this product's stack.\n\n${buildScopeDigest(content)}${statBlock}${hintLine}`;
}

/** Analyze whether the product can run on its services' free tiers and what
    limits it. `priorAssumptions` are the builder's edited stats from a prior run —
    passed back as authoritative so re-checks honor their corrected numbers.
    Strict-schema validation, then a safe empty shell on failure. */
export async function analyzeFreeTierFit(
  content: PrdContent,
  scaleHint?: string,
  priorAssumptions?: FreeTierAssumption[],
  meta?: AiCallMeta
): Promise<FreeTierAnalysis> {
  const currentDate = new Date().toISOString().slice(0, 10);
  const system = buildSystemPrompt(currentDate);
  const user = buildUserPrompt(content, scaleHint, priorAssumptions);

  // Single strict-schema call (the corrective second call is gone — strict mode
  // guarantees the shape). A parse/refinement failure falls to the safe shell.
  const raw = await callJson(system, user, jsonResponseFormat(FreeTierAnalysisResult, "free_tier_analysis"), meta);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }

  const result = FreeTierAnalysisResult.safeParse(stripNullsDeep(parsed));
  if (!result.success) return EMPTY;
  return result.data;
}
