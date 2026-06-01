/* Cascade-rename a technology across an entire PRD.

   When the builder renames a §9 tech-stack item, every other place that names the
   same technology should follow it: a duplicate stack row, the §8 integration with
   the same name, the Free-Tier Fit service verdicts, and any prose that mentions
   it. One deep, word-boundary-aware string replace over the whole content does all
   of these uniformly — structured `name` fields match because the whole value IS
   the old name, while prose matches token-by-token.

   Two safeguards make the blunt approach safe:
   • Names are regex-escaped, so "Next.js", "C++", ".NET" are matched literally.
   • A word boundary on each side keeps "React" from mangling "ReactDOM" and stops
     partial-token hits. We match case-sensitively (tech names carry canonical
     casing) to avoid swallowing common English words that double as tech names
     (e.g. a stack item named "Go" must not rewrite every "go" in prose).

   Kept as a plain (non-"use client") module so it can be unit-tested and reused
   server-side, mirroring lib/prd/section-fields.ts. */

import type { PrdContent } from "@/lib/types";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Recursively rewrite every string in a JSON-ish value, leaving structure intact. */
function deepReplace(value: unknown, replace: (s: string) => string): unknown {
  if (typeof value === "string") return replace(value);
  if (Array.isArray(value)) return value.map((v) => deepReplace(v, replace));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      out[key] = deepReplace((value as Record<string, unknown>)[key], replace);
    }
    return out;
  }
  return value;
}

/**
 * Replace every standalone occurrence of each name in `oldNames` with `newName`
 * across all of a PRD's text — structured technology names and free-form prose
 * alike. Pass a single string for a plain rename, or several aliases (e.g.
 * ["AWS", "Amazon Web Services"]) to retire a technology known by more than one
 * name. Returns a new content object; the input is left untouched. Blank names,
 * and any alias equal to `newName`, are skipped.
 */
export function renameTechAcrossPrd(
  content: PrdContent,
  oldNames: string | string[],
  newName: string
): PrdContent {
  const to = newName;
  const names = Array.from(
    new Set(
      (Array.isArray(oldNames) ? oldNames : [oldNames])
        .map((n) => n.trim())
        .filter((n) => n.length >= 1 && n !== to.trim())
    )
    // Longest first, so a short alias can't pre-empt a longer phrase that contains
    // it (replace "Amazon Web Services" before the bare "Amazon").
  ).sort((a, b) => b.length - a.length);
  if (names.length === 0) return content;

  let result: unknown = content;
  for (const from of names) {
    // (^|[^\w]) preserves any leading non-word char and avoids a lookbehind (wider
    // browser reach); (?![\w]) blocks partial-token matches on the trailing side. A
    // function replacer is used so a literal "$" in newName isn't read as a group ref.
    const re = new RegExp(`(^|[^\\w])${escapeRegExp(from)}(?![\\w])`, "g");
    result = deepReplace(result, (s) => s.replace(re, (_m, pre: string) => (pre ?? "") + to));
  }
  return result as PrdContent;
}
