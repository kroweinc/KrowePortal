import type { PrdUxFlow } from "@/lib/types";

/** Normalize a UX flow into an array of step strings. Supports the structured
    `steps[]` model and legacy single-string `flow` paragraphs ("1. … 2. …").
    Ported from the Claude Design prototype's prd-data.js. */
export function flowSteps(f?: PrdUxFlow | null): string[] {
  if (!f) return [];
  if (Array.isArray(f.steps)) return f.steps;
  const text = f.flow ? String(f.flow) : "";
  if (!text.trim()) return [];
  const parts = text
    .split(/\s*(?:^|\s)\d+\.\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [text.trim()];
}
