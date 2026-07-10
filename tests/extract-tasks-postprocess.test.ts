import { describe, expect, it } from "vitest";
import type { ExtractedTaskDraft } from "@/lib/ai/schemas";
import { ExtractTasksResult, ModelExtractTasksResult } from "@/lib/ai/schemas";
import { buildStrictSchema } from "@/lib/ai/strict-schema";
import {
  MEETING_NOTES,
  MEETING_TRANSCRIPT,
  OPTIONS,
  draft,
  goodModelOutput,
  degradedModelOutput,
  withoutSourceText,
} from "./fixtures/granola-meeting";
import {
  filterDraftsByOwner,
  normalizeOwner,
  parseAssignedBullets,
  postProcessExtraction,
  reconstructAllSourceText,
  reconstructSourceText,
} from "@/lib/ai/extract-tasks-postprocess";
import { significantTokens } from "@/lib/tasks/dedupe";

const STEVEN_TITLE_PATTERNS: RegExp[] = [
  /credential/i,
  /device tracking/i,
  /mypg drive file storage|migrate mypg/i,
  /mypg drive (case )?display|update mypg drive display/i,
  /pending matters/i,
  /case status call sheet(?!.*walkthrough)/i,
  /lawsuit submission (uploads|portal)/i,
  /reminder email/i,
  /walkthrough/i,
  /2014 to 2013|established/i,
  /hours to rahul/i,
];

function expectStevenTaskList(items: ExtractedTaskDraft[]) {
  const steven = filterDraftsByOwner(items, "builder");

  // Exactly the 11 explicitly assigned tasks — none missing, none invented.
  expect(steven).toHaveLength(11);
  for (const pattern of STEVEN_TITLE_PATTERNS) {
    expect(
      steven.some((t) => pattern.test(t.title)),
      `expected a Steven task matching ${pattern}`
    ).toBe(true);
  }

  // The docket-sheet review is Rahul's action item, never a Steven task.
  expect(steven.some((t) => /docket/i.test(t.title))).toBe(false);

  // No duplicated deliverables.
  const titles = steven.map((t) => t.title.toLowerCase());
  expect(new Set(titles).size).toBe(titles.length);
  // Launch + walkthrough both touch the Case Status Call Sheet but are
  // distinct deliverables — dedup must NOT have merged them.
  const launch = steven.find((t) => /case status call sheet/i.test(t.title) && !/walkthrough|video/i.test(t.title));
  const walkthrough = steven.find((t) => /walkthrough|video/i.test(t.title));
  expect(launch).toBeDefined();
  expect(walkthrough).toBeDefined();

  const text = (t: ExtractedTaskDraft) =>
    [t.title, t.description, ...t.checklist].join("\n").toLowerCase();

  // All five reminder-email requirements retained, exact values preserved.
  const reminder = steven.find((t) => /reminder email/i.test(t.title))!;
  const reminderText = text(reminder);
  expect(reminderText).toContain("please review your agent action item");
  expect(reminderText).toMatch(/7 days/);
  expect(reminderText).toMatch(/\+?90.?day/);
  expect(reminderText).toMatch(/client declined/);
  expect(reminderText).toContain("protest@patelgaines.com");
  expect(reminder.checklist.length).toBeGreaterThanOrEqual(5);

  // Credential-cleanup requirements retained as checklist entries.
  const credentials = steven.find((t) => /credential/i.test(t.title))!;
  expect(credentials.checklist.some((c) => /outdated temp/i.test(c))).toBe(true);
  expect(credentials.checklist.some((c) => /unset passwords permanent/i.test(c))).toBe(true);

  // Pending Matters keeps the agreed column cleanup.
  const pending = steven.find((t) => /pending matters/i.test(t.title))!;
  expect(text(pending)).toMatch(/column cleanup/);

  // "then push it live" survives as a completion criterion.
  const migrate = steven.find((t) => /migrate mypg|mypg drive file storage/i.test(t.title))!;
  expect(text(migrate)).toMatch(/push.*live|live/);

  // Other participants' tasks exist with the right owners BEFORE filtering.
  expect(filterDraftsByOwner(items, "Rahul")).toHaveLength(2);
  expect(filterDraftsByOwner(items, "Kathleen")).toHaveLength(1);
  expect(filterDraftsByOwner(items, "Maria")).toHaveLength(1);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("parseAssignedBullets", () => {
  it("finds every explicitly assigned bullet with its owner", () => {
    const bullets = parseAssignedBullets(MEETING_NOTES);
    expect(bullets).toHaveLength(15);
    expect(bullets.filter((b) => b.owner === "Steven")).toHaveLength(11);
    expect(bullets.filter((b) => b.owner === "Rahul")).toHaveLength(2);
    expect(bullets.filter((b) => b.owner === "Kathleen")).toHaveLength(1);
    expect(bullets.filter((b) => b.owner === "Maria")).toHaveLength(1);
  });

  it("captures nested sub-bullets and ';'/'then' clauses as requirements", () => {
    const bullets = parseAssignedBullets(MEETING_NOTES);
    const reminder = bullets.find((b) => /reminder email logic/.test(b.head))!;
    expect(reminder.clauses).toHaveLength(5);
    expect(reminder.clauses.some((c) => c.includes("protest@patelgaines.com"))).toBe(true);

    const credentials = bullets.find((b) => /credential/.test(b.head))!;
    expect(credentials.clauses).toHaveLength(3);

    const migrate = bullets.find((b) => /migrate MyPG/.test(b.head))!;
    expect(migrate.clauses).toEqual(["migrate MyPG Drive file storage to AWS", "push it live"]);
  });

  it("ignores unassigned prose and headers", () => {
    const bullets = parseAssignedBullets(
      "## Notes\n\nGeneral discussion about roadmap.\n- Note: revisit pricing later\n- we should probably clean things up\n"
    );
    expect(bullets).toHaveLength(0);
  });
});

describe("normalizeOwner", () => {
  it("maps the builder's aliases to 'builder'", () => {
    const aliases = ["Steven Ortega"];
    expect(normalizeOwner("builder", aliases)).toBe("builder");
    expect(normalizeOwner("Me", aliases)).toBe("builder");
    expect(normalizeOwner("Steven", aliases)).toBe("builder");
    expect(normalizeOwner("steven ortega", aliases)).toBe("builder");
  });

  it("canonicalizes other names so spellings compare equal", () => {
    expect(normalizeOwner("rahul", [])).toBe("Rahul");
    expect(normalizeOwner("RAHUL ", [])).toBe("Rahul");
    expect(normalizeOwner("chris stanton", [])).toBe("Chris Stanton");
    expect(normalizeOwner(undefined, [])).toBeUndefined();
    expect(normalizeOwner("  ", [])).toBeUndefined();
  });
});

describe("significantTokens", () => {
  it("keeps emails whole, splits hyphenated compounds, keeps numbers", () => {
    const tokens = significantTokens(
      "CC protest@patelgaines.com on the docket-sheet follow-up by 2013 in 7 days"
    );
    expect(tokens.has("protest@patelgaines.com")).toBe(true);
    expect(tokens.has("docket")).toBe(true);
    expect(tokens.has("sheet")).toBe(true);
    expect(tokens.has("2013")).toBe(true);
    expect(tokens.has("7")).toBe(true);
  });
});

describe("postProcessExtraction — faithful model output", () => {
  it("passes a complete extraction through and yields exactly Steven's 11 tasks", () => {
    const { items, repairs } = postProcessExtraction(goodModelOutput(), OPTIONS);
    expectStevenTaskList(items);
    // A faithful extraction needs no synthesized or reattributed repairs.
    expect(repairs.filter((r) => r.kind === "missing_task_synthesized")).toHaveLength(0);
    expect(repairs.filter((r) => r.kind === "owner_reattributed")).toHaveLength(0);
  });
});

describe("postProcessExtraction — degraded model output", () => {
  it("repairs omissions, misattribution, lost requirements, and duplicates", () => {
    const { items, repairs } = postProcessExtraction(degradedModelOutput(), OPTIONS);
    expectStevenTaskList(items);

    // The missed MyPG Drive display task was rebuilt from the notes…
    expect(repairs.some((r) => r.kind === "missing_task_synthesized")).toBe(true);
    const display = filterDraftsByOwner(items, "builder").find((t) =>
      /mypg drive display/i.test(t.title)
    )!;
    expect(display).toBeDefined();
    expect(display.sourceText).toContain("update MyPG Drive display");
    // …and keeps the original meaning without invention.
    expect(display.confidence).not.toBe("high");

    // The docket-sheet task was handed back to Rahul, not deleted silently.
    expect(
      repairs.some((r) => r.kind === "owner_reattributed" && /docket/i.test(r.detail))
    ).toBe(true);

    // The duplicate Case Status Call Sheet drafts merged.
    expect(repairs.some((r) => r.kind === "duplicate_merged")).toBe(true);

    // Lost requirements were appended, with the source recorded.
    const appended = repairs.filter((r) => r.kind === "requirement_appended");
    expect(appended.length).toBeGreaterThan(0);
    expect(appended.every((r) => r.sourceText && r.sourceText.length > 0)).toBe(true);
  });

  it("normalizes 'Steven' to builder instead of losing the task at the filter", () => {
    const { items } = postProcessExtraction(degradedModelOutput(), OPTIONS);
    const hours = filterDraftsByOwner(items, "builder").find((t) =>
      /hours to rahul/i.test(t.title)
    );
    expect(hours).toBeDefined();
  });
});

describe("postProcessExtraction — empty model output", () => {
  it("rebuilds every explicitly assigned action item from the notes", () => {
    const { items, repairs } = postProcessExtraction([], OPTIONS);
    expectStevenTaskList(items);
    expect(items).toHaveLength(15);
    expect(repairs.filter((r) => r.kind === "missing_task_synthesized")).toHaveLength(15);
    // Synthesized drafts stay verbatim-grounded and flag their uncertainty.
    for (const item of items) {
      expect(item.sourceText).toBeTruthy();
      expect(item.confidence).toBe("medium");
    }
  });
});

describe("parseAssignedBullets — header-ish words are not names", () => {
  it("never treats 'Logic:'/'Deadline:'/'Status:' bullets as assignments", () => {
    const notes = [
      "## Action items",
      "",
      "- Logic: sends reminders on the first Monday of the month.",
      "- Deadline: July 6 send covers everything with an October deadline.",
      "- Status: pending review with the team.",
      "- Goal: reduce the reminder backlog.",
    ].join("\n");
    expect(parseAssignedBullets(notes)).toHaveLength(0);
    // …so the completeness pass synthesizes nothing from them.
    const { items } = postProcessExtraction([], { notes, builderAliases: [] });
    expect(items).toHaveLength(0);
  });
});

describe("reconstructSourceText", () => {
  const CTX = { summary: MEETING_NOTES, transcript: MEETING_TRANSCRIPT };

  it("anchors on an exact sourceQuote and expands nested sub-bullets", () => {
    const result = reconstructSourceText(
      {
        title: "Update reminder email logic and copy",
        sourceQuote: "- Steven: update reminder email logic and copy:",
        checklist: [],
      },
      CTX
    )!;
    expect(result.startsWith("- Steven: update reminder email logic and copy:")).toBe(true);
    expect(result).toContain("protest@patelgaines.com");
    expect(result).toContain("+90 day");
    expect(result).toContain("Client declined");
    // The block ends at the sibling bullet — the walkthrough item is NOT pulled in.
    expect(result).not.toContain("video walkthroughs");
  });

  it("disambiguates near-identical bullets via the exact quote", () => {
    const launch = reconstructSourceText(
      {
        title: "Launch the Case Status Call Sheet",
        sourceQuote: "- Steven: push the Case Status Call Sheet live.",
        checklist: [],
      },
      CTX
    )!;
    expect(launch).toBe("- Steven: push the Case Status Call Sheet live.");

    const walkthrough = reconstructSourceText(
      {
        title: "Record and save portal walkthrough videos",
        sourceQuote:
          "- Steven: record video walkthroughs for PG Drive and the Case Status Call Sheet; save them in the master portal.",
        checklist: [],
      },
      CTX
    )!;
    expect(walkthrough).toContain("video walkthroughs");
    expect(walkthrough).not.toContain("push the Case Status Call Sheet live");
  });

  it("falls back to token matching when no quote is present", () => {
    const result = reconstructSourceText(
      { title: "Add device tracking to Agent Monitoring", sourceQuote: undefined, checklist: [] },
      CTX
    );
    expect(result).toBe("- Steven: add device tracking to Agent Monitoring.");
  });

  it("searches the summary before the transcript", () => {
    const result = reconstructSourceText(
      { title: "Send hours to Rahul", sourceQuote: "- Steven: send his hours to Rahul.", checklist: [] },
      CTX
    )!;
    expect(result).toBe("- Steven: send his hours to Rahul.");
  });

  it("falls back to the transcript when there is no summary (paste/upload shape)", () => {
    const result = reconstructSourceText(
      {
        title: "Send hours to Rahul",
        sourceQuote: "I'll send my hours over to Rahul before Friday",
        checklist: [],
      },
      { summary: null, transcript: MEETING_TRANSCRIPT }
    )!;
    expect(result).toContain("Me: And I'll send my hours over to Rahul before Friday.");
  });

  it("returns undefined when nothing matches confidently", () => {
    const result = reconstructSourceText(
      {
        title: "Buy groceries for the office party",
        sourceQuote: "we should order pizza for everyone",
        checklist: [],
      },
      CTX
    );
    expect(result).toBeUndefined();
  });

  it("caps the reconstructed block at 1200 chars", () => {
    const longNotes = [
      "- Steven: rebuild the entire reporting module:",
      ...Array.from({ length: 40 }, (_, i) => `  - requirement number ${i} ${"x".repeat(60)}`),
    ].join("\n");
    const result = reconstructSourceText(
      {
        title: "Rebuild the entire reporting module",
        sourceQuote: "- Steven: rebuild the entire reporting module:",
        checklist: [],
      },
      { summary: longNotes, transcript: "" }
    )!;
    expect(result.length).toBeLessThanOrEqual(1200);
  });
});

describe("postProcessExtraction — model output without sourceText", () => {
  const run = (items: ExtractedTaskDraft[]) =>
    postProcessExtraction(
      reconstructAllSourceText(items, { summary: MEETING_NOTES, transcript: "" }),
      OPTIONS
    );

  it("restores full grounding for a faithful extraction", () => {
    const { items, repairs } = run(withoutSourceText(goodModelOutput()));
    expectStevenTaskList(items);
    expect(repairs.filter((r) => r.kind === "missing_task_synthesized")).toHaveLength(0);
    expect(repairs.filter((r) => r.kind === "owner_reattributed")).toHaveLength(0);
  });

  it("still repairs a degraded extraction end to end", () => {
    const { items, repairs } = run(withoutSourceText(degradedModelOutput()));
    expectStevenTaskList(items);
    expect(repairs.some((r) => r.kind === "missing_task_synthesized")).toBe(true);
    expect(
      repairs.some((r) => r.kind === "owner_reattributed" && /docket/i.test(r.detail))
    ).toBe(true);
    expect(repairs.some((r) => r.kind === "duplicate_merged")).toBe(true);
  });
});

describe("model wire schema", () => {
  it("omits sourceText from the model-facing schema but keeps it server-side", () => {
    const wire = JSON.stringify(buildStrictSchema(ModelExtractTasksResult));
    expect(wire).toContain('"sourceQuote"');
    expect(wire).not.toContain('"sourceText"');
    // Contrast: the server-side parse schema still accepts sourceText.
    const server = JSON.stringify(buildStrictSchema(ExtractTasksResult));
    expect(server).toContain('"sourceText"');
  });
});

describe("filterDraftsByOwner", () => {
  it("filters by assignee after extraction", () => {
    const items = [
      draft({ title: "Builder work item", description: "x".repeat(20) }),
      draft({ title: "Builder work item 2", description: "x".repeat(20), owner: "builder" }),
      draft({ title: "Rahul work item", description: "x".repeat(20), owner: "Rahul" }),
    ];
    expect(filterDraftsByOwner(items, "builder")).toHaveLength(2);
    expect(filterDraftsByOwner(items, "Rahul")).toHaveLength(1);
    expect(filterDraftsByOwner(items, "Kathleen")).toHaveLength(0);
  });
});
