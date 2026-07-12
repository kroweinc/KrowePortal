import { describe, expect, it } from "vitest";
import { createPrdSectionScanner } from "@/lib/ai/prd-section-scanner";

/** Feed `text` through a fresh scanner in fixed-size chunks, collecting every key
    it emits — proves the state machine survives arbitrary delta boundaries. */
function scanInChunks(text: string, chunkSize: number): string[] {
  const push = createPrdSectionScanner();
  const keys: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    keys.push(...push(text.slice(i, i + chunkSize)));
  }
  return keys;
}

// A realistic finished-PRD envelope: nested objects/arrays, a value string that
// literally contains `"overview":` text, and an escaped quote inside prose.
const PRD_CONTENT = {
  overview: 'A referral tool. Note the phrase "overview": a decoy key inside a value.',
  goals: ["Capture referrals", 'Owner said \\"must be simple\\" — escaped quotes here'],
  successMetrics: [],
  users: [
    { role: "Admin", description: "The owner", authLevel: "full", permissions: ["View referrals"] },
    { role: "Referrer", description: "Public", authLevel: "none", permissions: [] },
  ],
  coreUserFlow: ["A referrer opens the form", "The system stores it"],
  features: [
    { title: "Referral form", description: "Public form", priority: "must", details: ["name", "email"], examples: ["REF-1024"] },
  ],
  requirements: ["Mobile friendly"],
  pagesScreens: [{ name: "Form", description: "Public", displays: ["fields", "submit"] }],
  successCriteria: ["A referrer can submit"],
  nonFunctionalRequirements: ["Loads fast"],
  scopeLater: ["Accounts"],
  futureExpansion: ["Analytics"],
  dataModel: [{ data: "Referral", direction: "import", source: "form" }],
  integrations: [{ name: "Resend", purpose: "email", monthlyCost: "$0/mo", estimated: true, domain: "resend.com" }],
  techStack: [{ name: "Next.js", category: "framework", provider: "Vercel", layer: "frontend", includes: ["form"], monthlyCost: "$0/mo", estimated: false, domain: "nextjs.org" }],
  uxFlows: [{ role: "Admin", steps: ["Log in", "View list"] }],
  assumptions: ["Client provides logo"],
  constraintsDetail: { deadline: "08/01/2026", budget: "modest", branding: "provided", security: "standard" },
  risks: ["Scope creep"],
  openQuestions: [],
  milestoneList: [{ label: "Build", dueDate: "07/25/2026" }],
  milestoneDueDate: "08/01/2026",
};

const EXPECTED_KEYS = Object.keys(PRD_CONTENT);

describe("createPrdSectionScanner", () => {
  const envelope = JSON.stringify({ kind: "prd", content: PRD_CONTENT });

  it("emits every top-level content key exactly once, in order", () => {
    // char-by-char is the worst case for boundary handling
    expect(scanInChunks(envelope, 1)).toEqual(EXPECTED_KEYS);
  });

  it("is stable across every chunk size", () => {
    for (const size of [1, 2, 3, 7, 13, 64, 100000]) {
      expect(scanInChunks(envelope, size)).toEqual(EXPECTED_KEYS);
    }
  });

  it("does not emit nested keys (role/title/name inside arrays and objects)", () => {
    const keys = scanInChunks(envelope, 5);
    expect(keys).not.toContain("role");
    expect(keys).not.toContain("title");
    expect(keys).not.toContain("permissions");
    expect(keys).not.toContain("deadline"); // nested inside constraintsDetail
  });

  it("is not fooled by a value string that contains a decoy key", () => {
    // `overview`'s value embeds the text `"overview":` — must not double-emit
    expect(scanInChunks(envelope, 4).filter((k) => k === "overview")).toHaveLength(1);
  });

  it("emits nothing for a question-round envelope (no content object)", () => {
    const q = JSON.stringify({
      kind: "questions",
      items: [{ id: "q1", text: "What is it?", options: ["A", "B"], multiSelect: false }],
    });
    expect(scanInChunks(q, 6)).toEqual([]);
  });

  it("stops at the content close and ignores trailing envelope keys", () => {
    // contextSummary is a sibling of content, not a section — must not be emitted
    const withSummary = JSON.stringify({ kind: "prd", content: PRD_CONTENT, contextSummary: "A business." });
    expect(scanInChunks(withSummary, 9)).toEqual(EXPECTED_KEYS);
  });
});
