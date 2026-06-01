import { openai, AI_MODEL } from "./client";
import { z } from "zod";

/* Semantic companion to the literal tech-rename cascade (lib/prd/rename-tech.ts).

   When the builder swaps a technology in §9 (e.g. AWS → Vercel, SendGrid → Resend),
   the old one is often still named elsewhere in a form a literal find/replace can't
   match: a different name for the same vendor ("AWS" vs "Amazon Web Services"), or
   the same product listed under a different §8 entry. This asks the model to LIST
   the exact phrases already present in the PRD that denote the now-removed
   technology. The model only names strings — it never rewrites prose — so the
   actual document edit stays deterministic and bounded on the client: each phrase
   is run through the same word-boundary replace. A phrase the model invents that
   isn't actually in the doc simply replaces nothing. */

const LooseSchema = z.object({ mentions: z.unknown() }).partial();

function normMentions(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const t = x.trim();
    if (t.length < 2 || t.length > 120) continue; // skip blanks / generic single letters / runaway strings
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= 12) break;
  }
  return out;
}

/**
 * Identify the verbatim phrases in `prdText` that still refer to the OLD technology
 * being replaced, so the client can swap each to the new name. Returns [] on any
 * error or when nothing relevant remains.
 */
export async function reconcileTechReferences(
  oldName: string,
  newName: string,
  prdText: string
): Promise<string[]> {
  const from = oldName.trim();
  const to = newName.trim();
  if (from.length < 2 || to.length < 2 || from.toLowerCase() === to.toLowerCase()) return [];

  const system = `A product requirements document (PRD) is having one technology replaced by another. Find EVERY phrase already written in the PRD that refers to the OLD technology, so each can be swapped to the new one.
Return ONLY this JSON shape: { "mentions": string[] }
- "mentions": exact substrings copied VERBATIM from the PRD text (same spelling, casing, spacing) that denote the OLD technology. Include its other name forms (e.g. "AWS" AND "Amazon Web Services"), the vendor/company name where it stands in for the product, and the same product wherever it is named in any other section (e.g. a 3rd-party-software / integrations list).
- Do NOT invent phrases that are not present in the text.
- Do NOT include the NEW technology, generic category words ("hosting", "email", "database", "framework"), or unrelated technologies.
- If nothing relevant remains, return { "mentions": [] }. Output valid JSON only.`;

  const user = `OLD technology being removed: ${from}
NEW technology replacing it: ${to}

PRD text:
${prdText.slice(0, 8000)}`;

  try {
    const res = await openai.chat.completions.create({
      model: AI_MODEL,
      max_completion_tokens: 400,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const parsed = LooseSchema.safeParse(JSON.parse(res.choices[0]?.message?.content || "{}"));
    const mentions = normMentions(parsed.success ? parsed.data.mentions : []);
    // Never echo the new name back as something to replace.
    return mentions.filter((m) => m.toLowerCase() !== to.toLowerCase());
  } catch {
    return [];
  }
}
