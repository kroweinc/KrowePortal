import { describe, expect, test } from "vitest";
import { diffList, isUnchanged, providedKeys, scopePatch } from "@/lib/doc/refine";
import { PrdContentSchema } from "@/lib/ai/schemas";
import { stripNullsDeep } from "@/lib/ai/strict-schema";

/* The refine preview's promise to the builder is "your instruction added to this
   section, it didn't replace it". These cover the shapes a PRD/quote section
   actually holds: string lists, object lists keyed by name/label/role, and the
   non-array values that fall back to a whole-value compare. */

describe("diffList — string lists", () => {
  test("an appended item is the only one marked new", () => {
    const diff = diffList(["Fast checkout", "Mobile first"], ["Fast checkout", "Mobile first", "Card payments"]);
    expect(diff).toEqual({ status: ["kept", "kept", "new"], removed: [] });
  });

  test("reordering is not a change", () => {
    const diff = diffList(["a", "b", "c"], ["c", "a", "b"]);
    expect(diff?.status).toEqual(["kept", "kept", "kept"]);
    expect(diff?.removed).toEqual([]);
  });

  test("matching ignores case and surrounding space", () => {
    expect(diffList([" Stripe "], ["stripe"])?.status).toEqual(["kept"]);
  });

  test("a dropped item is reported as removed", () => {
    const diff = diffList(["Twilio", "Stripe"], ["Stripe"]);
    expect(diff).toEqual({ status: ["kept"], removed: ["Twilio"] });
  });

  test("a duplicate of an existing entry counts as new", () => {
    const diff = diffList(["Stripe"], ["Stripe", "Stripe"]);
    expect(diff?.status).toEqual(["kept", "new"]);
  });

  test("an empty current list makes everything new", () => {
    expect(diffList([], ["a", "b"])?.status).toEqual(["new", "new"]);
  });
});

describe("diffList — object lists", () => {
  const current = [
    { name: "Google Calendar", purpose: "Booking sync" },
    { name: "Twilio", purpose: "SMS reminders" },
  ];

  test("identity is the name, so an edited description still reads as kept", () => {
    const next = [
      { name: "Google Calendar", purpose: "Two-way booking sync" },
      { name: "Twilio", purpose: "SMS reminders" },
      { name: "Stripe", purpose: "Card payments", monthlyCost: "$0" },
    ];
    const diff = diffList(current, next);
    expect(diff?.status).toEqual(["kept", "kept", "new"]);
    expect(diff?.removed).toEqual([]);
  });

  test("a renamed entry reads as one removed and one new", () => {
    const diff = diffList(current, [
      { name: "Google Calendar", purpose: "Booking sync" },
      { name: "Twilio SMS", purpose: "SMS reminders" },
    ]);
    expect(diff?.status).toEqual(["kept", "new"]);
    expect(diff?.removed).toEqual([{ name: "Twilio", purpose: "SMS reminders" }]);
  });

  // One case per identity key, because a shape whose key is missing from the list
  // silently reports every edit as a remove + an add.
  test.each([
    ["name (PrdIntegration)", { name: "Stripe", purpose: "a" }, { name: "Stripe", purpose: "b" }],
    ["title (PrdFeature, QuoteModule)", { title: "Auth", hours: 4 }, { title: "Auth", hours: 6 }],
    ["label (PrdMilestone, QuoteExtraCost)", { label: "Launch", dueDate: "03-01" }, { label: "Launch", dueDate: "04-01" }],
    ["role (PrdUserRole, PrdUxFlow)", { role: "Owner", steps: ["a"] }, { role: "Owner", steps: ["a", "b"] }],
    ["data (PrdDataSource)", { data: "Bookings", source: "Calendar" }, { data: "Bookings", source: "Calendar API" }],
    ["component (QuoteDesignComponent)", { component: "Buttons", included: true }, { component: "Buttons", included: false }],
  ])("an edited entry keyed by %s still reads as kept", (_label, before, after) => {
    const diff = diffList([before], [after]);
    expect(diff?.status).toEqual(["kept"]);
    expect(diff?.removed).toEqual([]);
  });

  test("objects with no identity key fall back to whole-value matching", () => {
    const diff = diffList([{ deadline: "March" }], [{ deadline: "March" }, { deadline: "April" }]);
    expect(diff?.status).toEqual(["kept", "new"]);
  });
});

describe("diffList — non-arrays", () => {
  test("returns null when either side isn't an array", () => {
    expect(diffList("some overview", "a longer overview")).toBeNull();
    expect(diffList(undefined, ["a"])).toBeNull();
    expect(diffList(["a"], undefined)).toBeNull();
  });
});

describe("isUnchanged", () => {
  test("compares strings and objects by value, not reference", () => {
    expect(isUnchanged("Overview text", "Overview text")).toBe(true);
    expect(isUnchanged("Overview text", "Overview text.")).toBe(false);
    expect(isUnchanged({ deadline: "March", budget: "$5k" }, { budget: "$5k", deadline: "March" })).toBe(true);
    expect(isUnchanged({ deadline: "March" }, { deadline: "April" })).toBe(false);
  });

  test("a key the model returned as null reads the same as an absent one", () => {
    expect(isUnchanged({ deadline: "March", budget: null }, { deadline: "March" })).toBe(true);
  });

  test("a missing current value against a proposed one is a change", () => {
    expect(isUnchanged(undefined, "New overview")).toBe(false);
  });
});

/* The whole "add, don't replace" contract rests on one thing: a key the model
   returned as null must reach the dashboard as ABSENT, so the merge preserves what
   the builder already has. Two layers conspire against that — stripNullsDeep drops
   the null, then .partial() re-materializes [] from the field's .default([]) — so
   the model's own signal has to be read off the raw JSON before parsing. */
describe("providedKeys + scopePatch", () => {
  test("a null key does not survive parsing on its own", () => {
    const parsed = PrdContentSchema.partial().parse(
      stripNullsDeep({ integrations: [{ name: "Stripe" }], goals: null })
    ) as Record<string, unknown>;
    // This is the trap: goals comes back as [] despite the model saying "untouched".
    expect(parsed.goals).toEqual([]);
  });

  test("scoping to the provided keys keeps the untouched one out of the patch", () => {
    const raw = { patch: { integrations: [{ name: "Stripe" }], goals: null } };
    const provided = providedKeys(raw.patch);
    const parsed = PrdContentSchema.partial().parse(stripNullsDeep(raw.patch)) as Record<string, unknown>;

    expect(scopePatch(parsed, ["integrations"], provided)).toEqual({
      integrations: [{ name: "Stripe" }],
    });
    expect(scopePatch(parsed, ["goals"], provided)).toEqual({});
  });

  test("an explicitly emptied key IS provided — clearing a section still works", () => {
    const provided = providedKeys({ goals: [] });
    expect(scopePatch({ goals: [] }, ["goals"], provided)).toEqual({ goals: [] });
  });

  test("a key outside the section never lands, however the model answers", () => {
    const provided = providedKeys({ overview: "hijacked", integrations: [] });
    expect(scopePatch({ overview: "hijacked", integrations: [] }, ["integrations"], provided)).toEqual({
      integrations: [],
    });
  });
});
