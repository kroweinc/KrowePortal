import { z } from "zod";
import type OpenAI from "openai";

/**
 * OpenAI Structured Outputs ("strict" mode) helper.
 *
 * Converts a zod schema into the `response_format: { type: "json_schema", … }`
 * payload OpenAI requires for guaranteed-conforming output, so the JSON
 * generators no longer need a second "your output didn't match, try again"
 * call (see lib/ai/generate-prd.ts and friends).
 *
 * zod v4's `z.toJSONSchema()` does most of the work, but its output violates
 * several OpenAI strict-mode rules, so we post-process it:
 *   - every property must be listed in `required` (optionals are expressed by
 *     making the value nullable instead of omitting it from `required`);
 *   - `additionalProperties: false` on every object;
 *   - no `default` keyword;
 *   - validation keywords OpenAI rejects/ignores (minLength, maximum, format, …)
 *     are stripped — zod still enforces them at safeParse time;
 *   - `oneOf` → `anyOf`.
 *
 * IMPORTANT: strict mode requires the ROOT to be an object. Discriminated-union
 * results (questions | prd) emit a root `oneOf`, which is illegal — only pass
 * single-object schemas here (the `*FinalResult` / TaskOnlyResult save paths).
 */

type ResponseFormat = NonNullable<
  OpenAI.Chat.Completions.ChatCompletionCreateParams["response_format"]
>;

// Toggle (default ON). Set OPENAI_STRICT_SCHEMA=false to fall every generator
// back to plain { type: "json_object" } without a code change.
export const STRICT_SCHEMA_ENABLED =
  (process.env.OPENAI_STRICT_SCHEMA ?? "true").trim().toLowerCase() !== "false";

// JSON-Schema keywords OpenAI strict mode rejects or silently ignores. zod still
// enforces these at safeParse time, so dropping them from the wire schema is safe.
const STRIP_KEYWORDS = [
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minItems",
  "maxItems",
  "multipleOf",
  "format",
  "pattern",
  "default",
  "$schema",
  "$id",
  "id",
];

type JsonNode = Record<string, unknown>;

function allowsNull(node: JsonNode): boolean {
  if (node.type === "null") return true;
  if (Array.isArray(node.type) && node.type.includes("null")) return true;
  const variants = node.anyOf ?? node.oneOf;
  if (Array.isArray(variants)) return variants.some((v) => allowsNull(v));
  return false;
}

function makeNullable(node: JsonNode): JsonNode {
  if (allowsNull(node)) return node;
  if (Array.isArray(node.anyOf)) return { ...node, anyOf: [...node.anyOf, { type: "null" }] };
  return { anyOf: [node, { type: "null" }] };
}

/** Recursively rewrite a JSON Schema node to satisfy OpenAI strict mode. */
function normalize(node: JsonNode): JsonNode {
  if (node == null || typeof node !== "object") return node;

  // oneOf (e.g. from discriminated unions on nested fields) → anyOf
  if (node.oneOf && !node.anyOf) {
    node.anyOf = node.oneOf;
    delete node.oneOf;
  }

  for (const k of STRIP_KEYWORDS) delete node[k];

  for (const key of ["anyOf", "allOf"] as const) {
    const arr = node[key];
    if (Array.isArray(arr)) node[key] = arr.map((n: JsonNode) => normalize(n));
  }

  if (node.items) {
    node.items = Array.isArray(node.items)
      ? node.items.map((n: JsonNode) => normalize(n))
      : normalize(node.items as JsonNode);
  }

  if (node.$defs && typeof node.$defs === "object") {
    const defs = node.$defs as Record<string, unknown>;
    for (const k of Object.keys(defs)) defs[k] = normalize(defs[k] as JsonNode);
  }

  if (node.properties && typeof node.properties === "object") {
    const properties = node.properties as Record<string, unknown>;
    const originalRequired = new Set<string>(Array.isArray(node.required) ? node.required : []);
    const keys = Object.keys(properties);
    for (const key of keys) {
      let child = normalize(properties[key] as JsonNode);
      // A property zod left out of `required` was .optional()/.nullish(); strict
      // mode forces it into `required`, so allow null to preserve "may be absent".
      if (!originalRequired.has(key)) child = makeNullable(child);
      properties[key] = child;
    }
    node.required = keys;
    node.additionalProperties = false;
  }

  return node;
}

/** Build the normalized JSON Schema object (exported for verification/tests). */
export function buildStrictSchema(schema: z.ZodType): JsonNode {
  const raw = z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any" }) as JsonNode;
  return normalize(raw);
}

const SAFE_NAME = /[^a-zA-Z0-9_-]/g;

/**
 * The `response_format` to send for a single-object generation. Returns a strict
 * json_schema when enabled and buildable; otherwise (disabled, or a normalizer
 * error) falls back to plain json_object so the call still succeeds.
 */
export function jsonResponseFormat(schema: z.ZodType, name: string): ResponseFormat {
  if (!STRICT_SCHEMA_ENABLED) return { type: "json_object" };
  try {
    return {
      type: "json_schema",
      json_schema: {
        name: name.replace(SAFE_NAME, "_").slice(0, 64),
        strict: true,
        schema: buildStrictSchema(schema),
      },
    };
  } catch (err) {
    console.warn(`[strict-schema] failed to build strict schema "${name}"; using json_object`, err);
    return { type: "json_object" };
  }
}

/**
 * Strict mode forces optional fields into `required` as nullable, so the model
 * emits `null` where a value is absent. Our zod schemas use .optional()/.nullish()
 * (which accept `undefined`, and for nullish also `null`) but a bare `null` on an
 * .optional()-only field would fail safeParse. Drop null-valued keys (deeply) so
 * they read as absent. Harmless for the json_object fallback path too.
 */
export function stripNullsDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripNullsDeep(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === null) continue;
      out[k] = stripNullsDeep(v);
    }
    return out as T;
  }
  return value;
}
