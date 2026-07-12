import { describe, expect, it } from "vitest";
import { createPrdSectionScanner } from "@/lib/ai/prd-section-scanner";
import { PrdSectionPatchSchema } from "@/lib/ai/schemas";
import { stripNullsDeep } from "@/lib/ai/strict-schema";

// A realistic finished-PRD envelope INCLUDING strict-mode nulls for unfilled
// sections (the model emits every key, some null) — the exact shape streamDraft's
// onContent completer must handle.
const CONTENT = {
  overview: "A referral tool for a gym.",
  goals: ["Capture referrals", "Reward referrers"],
  successMetrics: null,
  users: [{ role: "Admin", description: "Owner", authLevel: "full", permissions: ["View"] }],
  coreUserFlow: ["Open form", "Submit"],
  features: [{ title: "Form", description: "Public", priority: "must", details: ["name"], examples: ["REF-1"] }],
  requirements: ["Mobile friendly"],
  pagesScreens: [{ name: "Form", description: "Public", displays: ["fields"] }],
  successCriteria: ["Submits work"],
  nonFunctionalRequirements: null,
  scopeLater: ["Accounts"],
  futureExpansion: null,
  dataModel: [{ data: "Referral", direction: "import", source: "form" }],
  integrations: [{ name: "Resend", purpose: "email", monthlyCost: "$0/mo", estimated: true, domain: "resend.com" }],
  techStack: [{ name: "Next.js", provider: "Vercel", layer: "frontend", monthlyCost: "$0/mo", estimated: false }],
  uxFlows: null,
  assumptions: ["Client provides logo"],
  constraintsDetail: { deadline: "08/01/2026", budget: "modest", branding: "provided", security: "standard" },
  risks: ["Scope creep"],
  openQuestions: [],
  milestoneList: [{ label: "Build", dueDate: "07/25/2026" }],
  milestoneDueDate: "08/01/2026",
};

// Replicates stream-client.ts's onContent completer exactly.
function complete(scan: ReturnType<typeof createPrdSectionScanner>): unknown | null {
  const body = scan.safeContentBody();
  if (!body) return null;
  const parsed = stripNullsDeep(JSON.parse(`{${body}}`));
  const validated = PrdSectionPatchSchema.safeParse(parsed);
  return validated.success ? validated.data : "PARSE_FAILED";
}

describe("live-render completer (Tier 1)", () => {
  const envelope = JSON.stringify({ kind: "prd", content: CONTENT });

  it("produces a valid PrdContent partial at every section boundary, across chunk sizes", () => {
    for (const size of [1, 3, 7, 64, 100000]) {
      const scan = createPrdSectionScanner();
      let lastPartial: Record<string, unknown> = {};
      let boundaries = 0;
      for (let i = 0; i < envelope.length; i += size) {
        const keys = scan(envelope.slice(i, i + size));
        if (keys.length > 0) {
          const out = complete(scan);
          if (out === null) continue; // first key, nothing complete yet
          expect(out, `chunk size ${size}`).not.toBe("PARSE_FAILED");
          boundaries++;
          lastPartial = out as Record<string, unknown>;
        }
      }
      // The completer fired at least once, and — with fine-grained chunking like a
      // real token stream — once per section boundary (so the doc reveals section by
      // section). Coarse chunks collapse multiple keys into one push, which is fine.
      expect(boundaries, `chunk size ${size}`).toBeGreaterThanOrEqual(1);
      if (size <= 7) expect(boundaries, `chunk size ${size}`).toBeGreaterThan(5);
      expect(lastPartial.overview, `chunk size ${size}`).toBe(CONTENT.overview);
      expect(Array.isArray(lastPartial.goals), `chunk size ${size}`).toBe(true);
      // A strict-null section must never leak as null (zod may default it to []).
      expect(lastPartial.successMetrics ?? [], `chunk size ${size}`).toEqual([]);
      expect(lastPartial.successMetrics, `chunk size ${size}`).not.toBeNull();
    }
  });
});
