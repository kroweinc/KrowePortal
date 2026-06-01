import { openai, AI_MODEL } from "./client";
import type { SopIntake } from "@/lib/types";

const SYSTEM_PROMPT = `You are parsing raw discovery-call notes into a structured discovery-SOP shape that a software builder will use to scope a quote.

The notes are messy — typed live during a call, possibly fragmentary, out of order, with shorthand. Your job is to ORGANIZE what's there into the fields below. Do NOT invent facts, fill gaps with plausible-sounding content, or pad. If the notes don't cover a field, leave it as an empty string (or empty array for riskFlags). Use the operator's own words where possible; lightly clean up grammar only.

Output ONLY valid JSON in this exact shape:

{
  "businessContext": "What the business does, who they serve, team size, revenue model — the grounding context.",
  "theirIdeas": "Any solution the operator has already sketched out or is attached to. What they want it to look like, tools they're modeling after.",
  "whyNow": "The trigger — what changed, the cost of doing nothing, internal deadline or event driving timing.",
  "problemCurrentState": "The problem in concrete terms — what happens today end to end, where it breaks down, what it costs them.",
  "desiredOutcome": "What 'good' looks like in their words — the win, what they'd stop doing, the success metric.",
  "scope": "Deliverables they're imagining, must-haves vs nice-to-haves, existing assets to start from.",
  "audienceBrand": "Who the end users / target audience are; brand tone or constraints if mentioned.",
  "stackAccessOwnership": "Tools/platforms involved (CMS, CRM, hosting, payments, APIs), who owns the accounts, integration constraints.",
  "stakeholders": "Who signs off, who reviews day-to-day, how feedback flows, anyone skeptical or against it.",
  "timelineConstraints": "Target dates (hard/soft), blackout periods, feedback turnaround, compliance or legal gates.",
  "budgetSignal": "Any budget range, ceiling, prior similar spend, or whether they're comparing proposals. No quoting — signal only.",
  "riskFlags": [ "Concise flags the builder should be wary of: scope creep, unclear authority, timeline/scope mismatch, bad-fit signals, ambiguities in the notes." ]
}

Rules:
- Leave a field as "" if the notes genuinely don't address it. An empty field is correct and expected; a fabricated one is a failure.
- riskFlags is where you surface YOUR read of the notes — ambiguities, contradictions, missing-but-important info, red flags. Keep each flag to one sentence.
- Do not merge unrelated points into one field just to fill it. Put each fact where it belongs.`;

export async function parseSopNotes(rawNotes: string): Promise<SopIntake> {
  if (!rawNotes || rawNotes.trim().length === 0) return {};

  let parsed: Record<string, unknown> = {};
  try {
    const response = await openai.chat.completions.create({
      model: AI_MODEL,
      max_completion_tokens: 2000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Raw discovery-call notes:\n\n${rawNotes}` },
      ],
    });
    const raw = response.choices[0]?.message?.content ?? "{}";
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    console.error("[parseSopNotes] AI call failed", err);
    return {};
  }

  const str = (v: unknown): string =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : "";

  const riskFlags = Array.isArray(parsed.riskFlags)
    ? parsed.riskFlags.filter((f): f is string => typeof f === "string" && f.trim().length > 0).map((f) => f.trim())
    : [];

  return {
    businessContext: str(parsed.businessContext),
    theirIdeas: str(parsed.theirIdeas),
    whyNow: str(parsed.whyNow),
    problemCurrentState: str(parsed.problemCurrentState),
    desiredOutcome: str(parsed.desiredOutcome),
    scope: str(parsed.scope),
    audienceBrand: str(parsed.audienceBrand),
    stackAccessOwnership: str(parsed.stackAccessOwnership),
    stakeholders: str(parsed.stakeholders),
    timelineConstraints: str(parsed.timelineConstraints),
    budgetSignal: str(parsed.budgetSignal),
    riskFlags,
  };
}

// Maps the structured SOP intake into the existing BriefIntake shape that
// generateBriefDraft() consumes, so the quote draft is grounded in the
// parsed discovery fields.
export function sopIntakeToBriefIntake(
  sop: SopIntake,
  clientName?: string
): import("./generate-brief-draft").BriefIntake {
  const notesParts = [
    sop.businessContext && `Business context: ${sop.businessContext}`,
    sop.theirIdeas && `Their ideas so far: ${sop.theirIdeas}`,
    sop.stakeholders && `Stakeholders / decision-makers: ${sop.stakeholders}`,
    sop.budgetSignal && `Budget signal: ${sop.budgetSignal}`,
    sop.riskFlags && sop.riskFlags.length > 0 && `Risk flags: ${sop.riskFlags.join("; ")}`,
  ].filter(Boolean);

  return {
    clientName,
    problem: sop.problemCurrentState || undefined,
    whyNow: sop.whyNow || undefined,
    desiredOutcome: sop.desiredOutcome || undefined,
    audience: sop.audienceBrand || undefined,
    capabilities: sop.scope || undefined,
    integrations: sop.stackAccessOwnership || undefined,
    timeline: sop.timelineConstraints || undefined,
    outOfScope: undefined,
    notes: notesParts.length > 0 ? notesParts.join("\n") : undefined,
  };
}
