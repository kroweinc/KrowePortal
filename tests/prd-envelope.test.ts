import { describe, expect, it } from "vitest";

/* The { "kind": … } envelope recovery in parsePrdResult. A free interview round can
   only ask for plain json_object (a root discriminated union is illegal in strict
   mode), so the model regularly finalizes with the bare PRD content object at the top
   level — which used to be discarded, handing the builder fallback questions instead
   of the document it had just written.

   `generate-prd` pulls in the OpenAI client at import time, which throws without a
   key, so the module is imported dynamically after a placeholder is set. Nothing here
   makes a network call. */
process.env.OPENAI_API_KEY ??= "test-key-not-used";
const { parsePrdResult } = await import("@/lib/ai/generate-prd");

const FREE_ROUND = { forceFinal: false, mustAsk: false } as const;

const BARE_PRD = {
  overview: "A referral tracker for a local insurance agency.",
  goals: ["Capture referrals in one place"],
  users: [{ role: "Owner", description: "Runs the agency", authLevel: "admin", permissions: [] }],
  features: [
    { title: "Referral form", description: "Public form", priority: "must", details: [], examples: [] },
  ],
};

describe("parsePrdResult envelope recovery", () => {
  it("recovers a PRD returned without the kind envelope", () => {
    const result = parsePrdResult(JSON.stringify(BARE_PRD), FREE_ROUND);
    expect(result.kind).toBe("prd");
    if (result.kind !== "prd") return;
    expect(result.content.overview).toBe(BARE_PRD.overview);
    expect(result.content.features).toHaveLength(1);
  });

  it("recovers a PRD wrapped in content but missing kind, keeping the context summary", () => {
    const raw = JSON.stringify({ content: BARE_PRD, contextSummary: "A local insurance agency." });
    const result = parsePrdResult(raw, FREE_ROUND);
    expect(result.kind).toBe("prd");
    if (result.kind !== "prd") return;
    expect(result.content.overview).toBe(BARE_PRD.overview);
    expect(result.contextSummary).toBe("A local insurance agency.");
  });

  it("recovers questions returned without the kind envelope", () => {
    const raw = JSON.stringify({
      items: [
        { id: "q1", text: "Who uses it?", options: ["Owner", "Staff", "Both"], multiSelect: false },
        { id: "q2", text: "What ships first?", options: ["Form", "Dashboard", "Both"], multiSelect: false },
      ],
    });
    const result = parsePrdResult(raw, FREE_ROUND);
    expect(result.kind).toBe("questions");
    if (result.kind !== "questions") return;
    expect(result.items).toHaveLength(2);
  });

  // The floor exists to stop an invented PRD from ending the interview early. Rewrapping
  // must not become a way around it: a bare PRD on a must-ask round still fails the
  // round's questions-only schema and degrades to the fallback questions.
  it("does not let a bare PRD satisfy a floor round", () => {
    const result = parsePrdResult(JSON.stringify(BARE_PRD), { forceFinal: false, mustAsk: true });
    expect(result.kind).toBe("questions");
  });

  // An object that is neither shape is left alone — the degraded path, not a rewrap.
  it("leaves an unrecognizable object to the normal failure path", () => {
    const result = parsePrdResult(JSON.stringify({ overview: "just one key" }), FREE_ROUND);
    expect(result.kind).toBe("questions");
  });
});
