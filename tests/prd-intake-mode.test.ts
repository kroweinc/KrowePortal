import { describe, expect, it } from "vitest";
import {
  MAX_PRD_ROUNDS,
  MAX_PRD_ROUNDS_DEEP,
  MAX_PRD_ROUNDS_SEEDED,
  MIN_PRD_ROUNDS,
  SCOPE_STAGE_COUNT,
  planPrdRound,
  resolveIntakeMode,
  stageIndexForRound,
} from "@/lib/prd/scope-stages";
import { PrdQuestionsResult } from "@/lib/ai/schemas";
import { buildStrictSchema } from "@/lib/ai/strict-schema";

// The brief that used to be the ONLY input treated as substantive: anything non-empty.
const THIN = "an internal crm";
const REAL_BRIEF =
  "Car dealership wants one place to track every incoming lead — web form, calls, walk-ins, " +
  "Facebook, AutoTrader. The sales manager sees who's assigned and the follow-up status; reps " +
  "update only their own leads. Needs to work on desktop and phone, and email the manager a " +
  "daily digest of anything untouched for 48 hours.";

describe("resolveIntakeMode", () => {
  it("routes an empty notes box to the opener-led deep intake", () => {
    expect(resolveIntakeMode("")).toBe("deep");
    expect(resolveIntakeMode("   \n  ")).toBe("deep");
    expect(resolveIntakeMode(undefined)).toBe("deep");
  });

  it("routes a note that names only a product category to the seeded staged intake", () => {
    expect(resolveIntakeMode(THIN)).toBe("seeded");
    expect(resolveIntakeMode("a booking site for salons")).toBe("seeded");
  });

  it("routes a real brief to the adaptive interview", () => {
    expect(resolveIntakeMode(REAL_BRIEF)).toBe("notes");
  });
});

describe("stageIndexForRound", () => {
  it("spends deep round 0 on the opener, then one round per stage", () => {
    expect(stageIndexForRound("deep", 0)).toBeNull();
    expect(stageIndexForRound("deep", 1)).toBe(0);
    expect(stageIndexForRound("deep", SCOPE_STAGE_COUNT)).toBe(SCOPE_STAGE_COUNT - 1);
  });

  it("starts seeded at stage 0 — the notes already answered the opener", () => {
    expect(stageIndexForRound("seeded", 0)).toBe(0);
    expect(stageIndexForRound("seeded", SCOPE_STAGE_COUNT - 1)).toBe(SCOPE_STAGE_COUNT - 1);
  });

  it("has no fixed stages in the adaptive interview", () => {
    expect(stageIndexForRound("notes", 0)).toBeNull();
    expect(stageIndexForRound("notes", 3)).toBeNull();
  });
});

describe("planPrdRound — the interview floor", () => {
  // The regression this whole change exists for: "an internal crm" came back as a
  // finished, wholly-invented PRD with no question ever asked.
  it("never lets a thin note finalize on round 0", () => {
    const plan = planPrdRound(THIN, 0);
    expect(plan.mode).toBe("seeded");
    expect(plan.mustAsk).toBe(true);
    expect(plan.forceFinal).toBe(false);
    // Seeded skips the opener — round 0 is already a real scope stage.
    expect(plan.openerRound).toBe(false);
    expect(plan.stageIndex).toBe(0);
  });

  it("makes a thin note run every scope stage before the PRD is forced", () => {
    for (let round = 0; round < MAX_PRD_ROUNDS_SEEDED; round++) {
      expect(planPrdRound(THIN, round).mustAsk).toBe(true);
    }
    expect(planPrdRound(THIN, MAX_PRD_ROUNDS_SEEDED).forceFinal).toBe(true);
  });

  it("holds even a real brief to a minimum number of question rounds", () => {
    for (let round = 0; round < MIN_PRD_ROUNDS; round++) {
      const plan = planPrdRound(REAL_BRIEF, round);
      expect(plan.mode).toBe("notes");
      expect(plan.mustAsk).toBe(true);
    }
    // Past the floor the model decides for itself again — that discretion is the point
    // of the adaptive interview; it just can't be exercised on round 0 any more.
    expect(planPrdRound(REAL_BRIEF, MIN_PRD_ROUNDS).mustAsk).toBe(false);
    expect(planPrdRound(REAL_BRIEF, MIN_PRD_ROUNDS).forceFinal).toBe(false);
  });

  it("keeps the deep path's opener and stages intact", () => {
    const opener = planPrdRound("", 0);
    expect(opener.openerRound).toBe(true);
    expect(opener.seeded).toBe(false);
    for (let round = 1; round <= SCOPE_STAGE_COUNT; round++) {
      expect(planPrdRound("", round).mustAsk).toBe(true);
    }
    expect(planPrdRound("", MAX_PRD_ROUNDS_DEEP).forceFinal).toBe(true);
  });

  it("never asks and forces on the same round", () => {
    for (const notes of ["", THIN, REAL_BRIEF]) {
      for (let round = 0; round <= 10; round++) {
        const plan = planPrdRound(notes, round);
        expect(plan.mustAsk && plan.forceFinal).toBe(false);
      }
    }
  });

  it("synthesizes a reusable context summary for both staged modes only", () => {
    expect(planPrdRound("", 1).deepContext).toBe(true);
    expect(planPrdRound(THIN, 0).deepContext).toBe(true);
    expect(planPrdRound(REAL_BRIEF, 0).deepContext).toBe(false);
  });

  it("still forces the adaptive interview to finish at its ceiling", () => {
    expect(planPrdRound(REAL_BRIEF, MAX_PRD_ROUNDS).forceFinal).toBe(true);
  });
});

describe("PrdQuestionsResult", () => {
  const question = (id: string) => ({
    id,
    text: "Which roles need their own login?",
    options: ["Admin only", "Admin + reps", "Admin, reps, and read-only managers"],
    inputType: "choice" as const,
    multiSelect: false,
  });

  it("rejects a finished PRD, so a floor round cannot return one", () => {
    const asPrd = { kind: "prd", content: { overview: "An internal CRM for tracking leads." } };
    expect(PrdQuestionsResult.safeParse(asPrd).success).toBe(false);
  });

  it("accepts a normal question round", () => {
    const parsed = PrdQuestionsResult.safeParse({
      kind: "questions",
      items: [question("q1"), question("q2")],
    });
    expect(parsed.success).toBe(true);
  });

  it("builds a schema OpenAI strict mode accepts — a root object, fully required", () => {
    const schema = buildStrictSchema(PrdQuestionsResult) as Record<string, unknown>;
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["kind", "items"]);
    // `kind` pinned to the literal is what actually removes "here's the PRD" as an
    // option — prose alone had not been enough.
    expect((schema.properties as Record<string, { const?: string }>).kind.const).toBe("questions");
  });
});
