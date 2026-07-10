import { describe, it, expect } from "vitest";
import {
  normalizeTitle,
  titlesAreSimilar,
  findSimilarTitles,
  type TitleCandidate,
} from "@/lib/tasks/dedupe";

describe("normalizeTitle", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeTitle("  Set   Up  Stripe ")).toBe("set up stripe");
  });
});

describe("titlesAreSimilar", () => {
  it("flags near-identical titles (extra trailing word)", () => {
    expect(titlesAreSimilar("Set up Stripe checkout", "Set up Stripe checkout flow")).toBe(true);
  });

  it("flags a short title contained in a longer one", () => {
    expect(titlesAreSimilar("Stripe checkout", "Set up the Stripe checkout flow")).toBe(true);
  });

  it("does not flag titles that merely share one word", () => {
    // "fix" + "login" vs "fix" + "page" — jaccard 0.5, distinct deliverables.
    expect(titlesAreSimilar("Fix login bug", "Fix billing page")).toBe(false);
  });

  it("does not over-match a single generic word", () => {
    expect(titlesAreSimilar("Login", "Fix the login bug on mobile")).toBe(false);
  });

  it("ignores stopword/case/plural differences", () => {
    expect(titlesAreSimilar("Update the user fields", "Update user field")).toBe(true);
  });
});

describe("findSimilarTitles", () => {
  const candidates: TitleCandidate[] = [
    { id: "1", title: "Set up Stripe checkout flow" },
    { id: "2", title: "Design the onboarding email" },
    { id: "3", title: "Add webhook retry handling" },
  ];

  it("returns the matching open task, best first", () => {
    const matches = findSimilarTitles("Set up Stripe checkout", candidates);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].id).toBe("1");
  });

  it("returns nothing when no candidate is similar", () => {
    expect(findSimilarTitles("Write the Q3 investor update", candidates)).toEqual([]);
  });

  it("returns nothing for an empty candidate list", () => {
    expect(findSimilarTitles("Set up Stripe checkout", [])).toEqual([]);
  });

  it("handles a title with no significant tokens", () => {
    expect(findSimilarTitles("the a of", candidates)).toEqual([]);
  });
});
