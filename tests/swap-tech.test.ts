import { describe, it, expect } from "vitest";
import { applyTechSwap, fillSwappedRows, resolveTechName } from "@/lib/prd/swap-tech";
import type { PrdContent } from "@/lib/types";
import type { StackLookup } from "@/lib/ai/lookup-stack-item";

// The pure core of swap_prd_tech: a "change the database from Postgres to Supabase"
// swap must reach the §9 stack row, the matching §8 integration, the Free-Tier Fit
// verdict, and prose — while a word boundary keeps it from mangling a longer token.

function prd(): PrdContent {
  return {
    overview: "Postgres powers the app; PostgresDBAdmin stays separate.",
    techStack: [
      {
        name: "Postgres",
        layer: "database",
        provider: "PostgreSQL",
        domain: "postgresql.org",
        includes: ["Relational database"],
        monthlyCost: null,
        estimated: false,
      },
      { name: "Next.js", layer: "frontend", provider: "Vercel", domain: "nextjs.org" },
    ],
    integrations: [{ name: "Postgres", purpose: "Primary datastore" }],
    freeTierAnalysis: {
      overallFitsFree: "yes",
      assumptions: [],
      services: [{ name: "Postgres", hasFreeTier: true, fitsFree: "yes" }],
    },
  };
}

describe("applyTechSwap", () => {
  it("cascades the rename across the stack row, integration, verdict, and prose", () => {
    const { content, changed } = applyTechSwap(prd(), "Postgres", "Supabase");
    expect(changed).toBe(true);
    expect(content.techStack?.[0].name).toBe("Supabase");
    expect(content.integrations?.[0].name).toBe("Supabase");
    expect(content.freeTierAnalysis?.services[0].name).toBe("Supabase");
    expect(content.overview).toContain("Supabase powers the app");
  });

  it("leaves a longer token untouched (word boundary)", () => {
    const { content } = applyTechSwap(prd(), "Postgres", "Supabase");
    expect(content.overview).toContain("PostgresDBAdmin stays separate");
  });

  it("cascades reconciled alternate name forms too", () => {
    const withAlias: PrdContent = { ...prd(), overview: "Built on PostgreSQL 15." };
    const { content } = applyTechSwap(withAlias, "Postgres", "Supabase", ["PostgreSQL"]);
    expect(content.overview).toBe("Built on Supabase 15.");
  });

  it("is a no-op (unchanged, same reference) when the PRD never names `from`", () => {
    const before = prd();
    const { content, changed } = applyTechSwap(before, "MySQL", "Supabase");
    expect(changed).toBe(false);
    expect(content).toBe(before);
  });

  // The bug that shipped: the builder types "Postgres" but the §9 row is named
  // "PostgreSQL". The word-boundary cascade can't match ("QL" blocks the boundary),
  // so the row silently stayed. resolveTechName now bridges the loose spelling.
  it("swaps the §9 row when the builder's `from` differs from the row's real name", () => {
    const withLongName: PrdContent = {
      ...prd(),
      overview: "The app runs on Postgres today.",
      techStack: [
        { name: "PostgreSQL", layer: "database", provider: "Managed provider", domain: "postgresql.org" },
        { name: "Next.js", layer: "frontend", provider: "Vercel", domain: "nextjs.org" },
      ],
      integrations: [],
      freeTierAnalysis: {
        overallFitsFree: "yes",
        assumptions: [],
        services: [{ name: "PostgreSQL", hasFreeTier: true, fitsFree: "yes" }],
      },
    };
    const { content, changed } = applyTechSwap(withLongName, "Postgres", "Supabase");
    expect(changed).toBe(true);
    expect(content.techStack?.[0].name).toBe("Supabase"); // the §9 row actually changed
    expect(content.freeTierAnalysis?.services[0].name).toBe("Supabase");
    expect(content.overview).toBe("The app runs on Supabase today."); // typed spelling too
  });
});

describe("resolveTechName", () => {
  const content: PrdContent = {
    techStack: [
      { name: "PostgreSQL", layer: "database" },
      { name: "Next.js", layer: "frontend" },
      { name: "Go", layer: "backend" },
    ],
    integrations: [{ name: "Google Workspace Gmail", purpose: "Email" }],
  };

  it("returns the exact row name unchanged (case-insensitive)", () => {
    expect(resolveTechName(content, "postgresql")).toBe("PostgreSQL");
  });

  it("bridges a loose prefix spelling to the real row name", () => {
    expect(resolveTechName(content, "Postgres")).toBe("PostgreSQL");
  });

  it("resolves punctuation/spacing differences via normalization", () => {
    expect(resolveTechName(content, "nextjs")).toBe("Next.js");
  });

  it("does not over-match short names (Go must not hit Google Workspace)", () => {
    expect(resolveTechName(content, "Go")).toBe("Go"); // exact wins, not the Google prefix
  });

  it("falls back to the typed form when there's no confident match", () => {
    expect(resolveTechName(content, "MySQL")).toBe("MySQL");
  });
});

describe("fillSwappedRows", () => {
  const lookup: StackLookup = {
    provider: "Supabase",
    category: "Backend-as-a-Service",
    layer: "database",
    includes: ["Postgres database", "Auth", "Storage"],
    monthlyCost: "$25/mo",
    domain: "supabase.com",
  };

  it("re-fills the swapped row with the new tool's facts, leaving others alone", () => {
    const { content } = applyTechSwap(prd(), "Postgres", "Supabase");
    const filled = fillSwappedRows(content, "Supabase", lookup);
    const db = filled.techStack?.[0];
    expect(db?.provider).toBe("Supabase");
    expect(db?.domain).toBe("supabase.com");
    expect(db?.includes).toEqual(["Postgres database", "Auth", "Storage"]);
    expect(db?.monthlyCost).toBe("$25/mo");
    expect(db?.estimated).toBe(true); // a supplied rate is flagged as an estimate
    // The unrelated frontend row keeps its own values.
    expect(filled.techStack?.[1].name).toBe("Next.js");
    expect(filled.techStack?.[1].domain).toBe("nextjs.org");
  });
});
