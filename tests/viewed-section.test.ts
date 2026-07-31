import { describe, it, expect, beforeEach } from "vitest";
import {
  setViewedSection,
  clearViewedSection,
  getViewedSection,
  sectionForViewedDoc,
} from "@/lib/prd/viewed-section";

// The submit-time signal that lets an agent turn assume the PRD section the builder
// is scrolled to ("change the tech stack" → techStack). The gating in
// sectionForViewedDoc is the safety net: a section is trusted ONLY when it belongs
// to the PRD the turn is actually scoped to, so a stale section from a
// previously-open PRD (or a section while viewing a quote/contract) never leaks.

const PRD_A = "11111111-1111-1111-1111-111111111111";
const PRD_B = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  clearViewedSection(PRD_A);
  clearViewedSection(PRD_B);
});

describe("viewed-section", () => {
  it("returns the section when the viewed doc is the same PRD", () => {
    setViewedSection(PRD_A, "techStack");
    expect(sectionForViewedDoc({ kind: "prd", id: PRD_A })).toBe("techStack");
  });

  it("rejects a section from a different PRD (stale leak guard)", () => {
    setViewedSection(PRD_A, "techStack");
    expect(sectionForViewedDoc({ kind: "prd", id: PRD_B })).toBeNull();
  });

  it("never attaches a section to a quote or contract turn", () => {
    setViewedSection(PRD_A, "techStack");
    expect(sectionForViewedDoc({ kind: "quote", id: PRD_A })).toBeNull();
    expect(sectionForViewedDoc({ kind: "contract", id: PRD_A })).toBeNull();
  });

  it("returns null with no doc in view", () => {
    setViewedSection(PRD_A, "techStack");
    expect(sectionForViewedDoc(null)).toBeNull();
    expect(sectionForViewedDoc(undefined)).toBeNull();
  });

  it("clears only when the prd matches, and reflects the latest section", () => {
    setViewedSection(PRD_A, "features");
    setViewedSection(PRD_A, "techStack");
    expect(getViewedSection()).toEqual({ prdId: PRD_A, sectionId: "techStack" });
    clearViewedSection(PRD_B); // unrelated PRD unmounting — must not wipe A
    expect(sectionForViewedDoc({ kind: "prd", id: PRD_A })).toBe("techStack");
    clearViewedSection(PRD_A);
    expect(getViewedSection()).toBeNull();
  });
});
