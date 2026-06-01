import { openai, AI_MODEL } from "./client";
import { z } from "zod";

/* Auto-lookup for the PRD "Tech Stack & Infrastructure" (§9) and
   "Integrations & 3rd-Party Software" (§8) sections. When the builder renames
   an item, we look the technology up by name and return the surrounding facts
   (provider, layer, what it covers, typical monthly rate / purpose) so the rest
   of the card can auto-fill. Any cost we supply is a published-rate ESTIMATE the
   builder must verify — we flag it with `estimated: true`. */

const LAYERS = ["frontend", "backend", "database", "email", "hosting", "other"] as const;
type Layer = (typeof LAYERS)[number];

export type StackLookup = {
  provider: string | null;
  category: string | null;
  layer: Layer | null;
  includes: string[];
  monthlyCost: string | null;
};

export type IntegrationLookup = {
  purpose: string | null;
  monthlyCost: string | null;
};

// Parse the model's JSON LENIENTLY: every field optional/any, so one off-spec
// value (e.g. layer "Database", an over-long string) can't reject the whole
// object. We normalize into the strict shape ourselves below.
const LooseSchema = z
  .object({
    provider: z.unknown(),
    category: z.unknown(),
    layer: z.unknown(),
    includes: z.unknown(),
    purpose: z.unknown(),
    monthlyCost: z.unknown(),
  })
  .partial();

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function normLayer(v: unknown): Layer | null {
  if (typeof v !== "string") return null;
  const low = v.trim().toLowerCase();
  return (LAYERS as readonly string[]).includes(low) ? (low as Layer) : null;
}

function normIncludes(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((x) => x.slice(0, 200));
}

const COST_NOTE = `monthlyCost is the provider's OWN published subscription rate per month (e.g. "~$25/mo", "$0/mo + 2.9% per txn"), never a developer fee or setup cost. Supply it from typical published pricing you know; if a tool is genuinely free at the relevant tier, use "$0/mo". If you truly cannot estimate a rate, return null for monthlyCost.`;

async function callJson(system: string, user: string): Promise<unknown> {
  const res = await openai.chat.completions.create({
    model: AI_MODEL,
    max_completion_tokens: 600,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  try {
    return JSON.parse(res.choices[0]?.message?.content || "{}");
  } catch {
    return {};
  }
}

function contextLine(context?: string): string {
  const trimmed = (context ?? "").trim();
  if (!trimmed) return "";
  return `\nProduct context (for right-sizing cost and what the layer covers): ${trimmed.slice(0, 1200)}`;
}

/** Look up a tech-stack item by name → provider, layer, includes, monthly rate. */
export async function lookupStackItem(name: string, context?: string): Promise<StackLookup | null> {
  const clean = name.trim();
  if (!clean) return null;

  const system = `You identify a single named technology in a software project's tech stack and return structured facts about it as JSON.
Return ONLY this JSON shape: { "provider": string|null, "category": string|null, "layer": ${JSON.stringify(LAYERS)}, "includes": string[], "monthlyCost": string|null }
- provider: the OFFICIAL corporate / legal company name of the organization that makes, owns, or operates this technology — ALWAYS fill this, even when the tech's name and the brand are the same. Use the proper corporate entity name, e.g. "Next.js" → "Vercel Inc.", "Vercel" → "Vercel Inc.", "Supabase" → "Supabase Inc.", "PostgreSQL" → "PostgreSQL Global Development Group", "Redis" → "Redis Ltd.", "S3" → "Amazon Web Services, Inc.", "React" → "Meta Platforms, Inc.", "MongoDB" → "MongoDB, Inc.". Only return null if it is a truly generic, unbranded technology with no company or steward behind it.
- category: a short kind label (e.g. "Framework", "Managed Postgres", "Object storage", "Auth", "Email API").
- layer: which layer of the stack this belongs to. Pick the single best fit.
- includes: 1–4 SHORT phrases describing what this layer/tool covers FOR THIS PRODUCT given the context. Concrete, not generic.
- ${COST_NOTE}
If the name is unrecognizable or not a real technology, return best-effort nulls and an empty includes array. Output valid JSON only.`;

  const user = `Technology name: ${clean}${contextLine(context)}`;
  const parsed = LooseSchema.safeParse(await callJson(system, user));
  const raw = parsed.success ? parsed.data : {};
  return {
    provider: str(raw.provider, 120),
    category: str(raw.category, 80),
    layer: normLayer(raw.layer),
    includes: normIncludes(raw.includes),
    monthlyCost: str(raw.monthlyCost, 80),
  };
}

/** Look up a 3rd-party software/integration by name → purpose + monthly rate. */
export async function lookupIntegrationItem(name: string, context?: string): Promise<IntegrationLookup | null> {
  const clean = name.trim();
  if (!clean) return null;

  const system = `You identify a single named 3rd-party software product or integration and return structured facts about it as JSON.
Return ONLY this JSON shape: { "purpose": string|null, "monthlyCost": string|null }
- purpose: one concise sentence on what this software is for IN THIS PRODUCT given the context (e.g. "Sends transactional emails to referrers", "Processes one-time card payments").
- ${COST_NOTE}
If the name is unrecognizable, return best-effort nulls. Output valid JSON only.`;

  const user = `Software name: ${clean}${contextLine(context)}`;
  const parsed = LooseSchema.safeParse(await callJson(system, user));
  const raw = parsed.success ? parsed.data : {};
  return {
    purpose: str(raw.purpose, 200),
    monthlyCost: str(raw.monthlyCost, 80),
  };
}
