/* System prompts for the "refine one section from an instruction" flow, shared by
   the PRD and quote generators.

   Two reasons this is its own module rather than living in the generators:
   the numbered procedure is the entire behavioral contract of the feature
   ("add, don't replace") and had started to drift as two copies; and this file
   imports no OpenAI client, so the snapshot tests can render it without a key.

   Each prompt is a pure function of NOTHING — the section being refined is
   dynamic data and rides in the user prompt. That keeps the system message
   byte-identical across every refine, which is what makes the cached prefix
   (system + the document JSON that follows it) worth anything. */

/** The instruction-handling procedure. Identical for both document types: only
    the examples in rule 1 and the quality rules below differ. */
function instructionRules(examples: string, alsoPreserve: string): string {
  return `How to apply the instruction:
1. The instruction is written casually. Expect a fragment, lowercase, a typo, or two words (${examples}). Read it for intent and act on it. Never ask a clarifying question and never restate the instruction back — the builder sees only the section you return.
2. Change only what the instruction asks for. Everything it does not mention comes back exactly as it is today — same wording, same order${alsoPreserve}.
3. Default to ADDING. When the instruction names something new, append it and keep every existing entry. Rewrite or drop an existing entry only when the instruction asks you to change or remove that entry.
4. For every key you change, return its COMPLETE new value — the full list including the entries you kept, because the value you return replaces the key outright.
5. For a key the instruction doesn't touch, return null. A null key is left exactly as it is.
6. If the instruction is off-topic for this section, or you can't tell what it asks for, return null for every key. An unchanged section is the correct answer when there is nothing to apply — inventing a change the builder didn't ask for is worse than doing nothing.
7. Match what's already there: same depth, same voice, same level of detail. Keep each entry under 300 characters and each list at 30 entries or fewer; longer output is rejected and the builder sees nothing.`;
}

const PRD_QUALITY_RULES = `Write RICH, CONCRETE content for a small-business owner who must recognize THEIR product — never generic, never one-liners. Aim for the depth of a polished, client-ready document.
- You ARE encouraged to include ILLUSTRATIVE examples (sample options, field lists, sample ID formats), clearly framed as examples — never as committed facts.
- Do NOT fabricate CLIENT-SPECIFIC facts (real vendors, negotiated prices, a real deadline, a chosen tool the builder hasn't agreed to). For any cost you supply from general knowledge, set "estimated": true on that item.
- Never include a project price or payment terms anywhere in the PRD — those live in the separate quote.
- Keep the section consistent with the rest of the PRD (the full document is provided for context). Do not contradict other sections.`;

const QUOTE_QUALITY_RULES = `Write concrete, client-ready content for a non-technical small-business owner — never generic, never one-liners.
- Ground the section in the actual product described by the rest of the quote (provided for context). Do not contradict other sections.
- Pricing is EFFORT-based and AI-ASSISTED: if you touch "modules", give each line item as { label, hours, notes? } where "hours" is a realistic builder-hour estimate assuming AI coding agents one-shot most straightforward UI/CRUD work (a basic form ≈ 0.5–1.5h, NOT a day; a whole standard CRUD module ≈ 2–6h). Reserve larger hours (~2–8h each) for integrations, auth/security, and work that needs real debugging or testing. Do NOT output dollar amounts, subtotals, costs, or totals; the runtime prices each item as hours × the quote's hourly rate. Be honest, don't pad. If you touch "paymentMilestones", return { label, percent } with percents summing to 100; the runtime computes the dollar amounts from the grand total.
- All figures are implementation ESTIMATES, not a binding contract.
- Do NOT fabricate client-specific facts (a real signed budget, a real deadline).`;

export function buildRefineSectionSystemPrompt(): string {
  return `You are REFINING a single section of an existing OUTBOUND Product Requirements Document (PRD). The builder has typed a short instruction describing what they want changed. Apply it to the one section named in the message below and return that section's updated values.

Use the rest of the PRD as context only — it is provided so the section you return stays consistent with the document, not for you to edit.

${instructionRules(`"add stripe", "shorter", "mention the deadline"`, "")}

${PRD_QUALITY_RULES}`;
}

export function buildRefineQuoteSectionSystemPrompt(): string {
  return `You are REFINING a single section of an existing OUTBOUND product QUOTE (a client-facing price breakdown). The builder has typed a short instruction describing what they want changed. Apply it to the one section named in the message below and return that section's updated values.

Use the rest of the quote as context only — it is provided so the section you return stays consistent with the document, not for you to edit.

${instructionRules(`"add a training module", "shorter", "more hours on auth"`, ", same hours")}

${QUOTE_QUALITY_RULES}`;
}
