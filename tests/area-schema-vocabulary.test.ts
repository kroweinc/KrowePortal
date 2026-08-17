import { describe, expect, test } from "vitest";
import {
  ExtractedTaskDraft,
  extractedTaskDraft,
  taskClassifyResult,
  TaskClassifyResult,
} from "@/lib/ai/schemas";
import { FALLBACK_AREA_VOCABULARY, TASK_TAGS } from "@/lib/types";

// The trap this file exists to pin down.
//
// Every task schema is now a FACTORY over the allowed area slugs, and each
// factory also has a bare const built from the fallback taxonomy. The consts are
// convenient and type-check everywhere — `tagList` widens the inferred type to
// `string[]`, so passing a repo slug through one is invisible to tsc. But at
// RUNTIME the const's tags field is `z.enum(TASK_TAGS)`, so it rejects every
// repo-derived area.
//
// That cost us twice: the Granola approval schema and the SSE route's per-item
// parse were both left on the const, which silently broke approval and
// progressive streaming for exactly the repos the feature targets. The rule is:
// any site that PARSES a model response, or validates something derived from
// one, must build its schema from the same vocabulary the request used.

const REPO_SLUGS = ["checkout", "reporting", "accounts"];

function draft(area: string) {
  return {
    title: "Add a bulk download to the folder view",
    description: "Selecting forty documents one at a time is too slow for real use.",
    priority: "medium",
    type: "feature",
    tags: [area],
    checklist: [],
    dependencies: [],
    confidence: "high",
  };
}

describe("area vocabulary schemas", () => {
  test("the fallback const REJECTS a repo-derived area", () => {
    // Not a bug — it is the whole reason a parse site must not use the const.
    expect(ExtractedTaskDraft.safeParse(draft("checkout")).success).toBe(false);
    expect(TaskClassifyResult.safeParse({ type: "bug", tags: ["checkout"] }).success).toBe(false);
  });

  test("a schema built from the repo vocabulary accepts it", () => {
    expect(extractedTaskDraft(REPO_SLUGS).safeParse(draft("checkout")).success).toBe(true);
    expect(
      taskClassifyResult(REPO_SLUGS).safeParse({ type: "bug", tags: ["checkout"] }).success
    ).toBe(true);
  });

  test("a repo vocabulary still rejects a label outside itself", () => {
    // The closed list is what stops one-off free-form tags; swapping the
    // vocabulary must not turn the enum into a free string.
    expect(extractedTaskDraft(REPO_SLUGS).safeParse(draft("pdf-forms")).success).toBe(false);
    // …including the fallback labels, which are not this repo's vocabulary.
    expect(extractedTaskDraft(REPO_SLUGS).safeParse(draft("ui")).success).toBe(false);
  });

  test("the fallback vocabulary round-trips its own labels", () => {
    for (const tag of TASK_TAGS) {
      expect(ExtractedTaskDraft.safeParse(draft(tag)).success).toBe(true);
    }
    expect(FALLBACK_AREA_VOCABULARY.values.map((a) => a.slug)).toEqual([...TASK_TAGS]);
  });

  test("every fallback label carries a gloss for the classifier", () => {
    // A label with no gloss is a bare word the model has to guess the meaning
    // of, which is what the Record<TaskTag, string> in lib/types.ts prevents.
    for (const area of FALLBACK_AREA_VOCABULARY.values) {
      expect(area.gloss.length).toBeGreaterThan(10);
    }
  });

  test("an over-long tags array is truncated, not rejected", () => {
    // Strict mode strips maxItems from the wire schema, so the model does
    // occasionally return two. Keeping the first beats failing the generation.
    const parsed = extractedTaskDraft(REPO_SLUGS).safeParse({
      ...draft("checkout"),
      tags: ["checkout", "reporting"],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.tags).toEqual(["checkout"]);
  });

  test("schema factories are memoized per vocabulary, not shared across them", () => {
    expect(taskClassifyResult(REPO_SLUGS)).toBe(taskClassifyResult([...REPO_SLUGS]));
    expect(taskClassifyResult(REPO_SLUGS)).not.toBe(taskClassifyResult(["billing", "shipping"]));
  });
});
