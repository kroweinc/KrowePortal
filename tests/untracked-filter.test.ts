import { describe, expect, it } from "vitest";
import {
  filterUntrackedItems,
  isNoiseSubject,
  MAX_GAPS_PER_PUSH,
  type PushEvidence,
  type UntrackedWorkCandidate,
} from "@/lib/tasks/untracked-filter";

// The deterministic net under the untracked-work model. Every rule here is
// something the prompt already asks for — these tests cover the case where it
// didn't comply, which is the only case the net exists for.

const push: PushEvidence = {
  commits: [
    { sha: "a1b2c3d4e5f", subject: "feat(agent): render the report to PDF" },
    { sha: "b2c3d4e5f6a", subject: "fix(agent): page breaks in the PDF export" },
    { sha: "c3d4e5f6a7b", subject: "chore(deps): bump next to 16.1.2" },
    { sha: "d4e5f6a7b8c", subject: "Merge branch 'AgentPDF' into dev" },
  ],
};

const item = (
  over: Partial<UntrackedWorkCandidate> = {}
): UntrackedWorkCandidate => ({
  title: "Add PDF export to the agent report",
  description: "Renders the agent report as a downloadable PDF from the report page.",
  priority: "medium",
  type: "feature",
  tags: ["backend"],
  shas: ["a1b2c3d4e5f", "b2c3d4e5f6a"],
  files: ["lib/pdf/render.ts"],
  confidence: "high",
  ...over,
});

describe("isNoiseSubject", () => {
  it("catches the housekeeping that never deserved a task", () => {
    for (const subject of [
      "Merge branch 'dev' into main",
      "chore(deps): bump next to 16.1.2",
      "ci: cache the pnpm store",
      "style: run prettier",
      "v1.4.2",
      "fix typo in the README",
      "wip",
      "Revert \"feat: half-built thing\"",
    ]) {
      expect(isNoiseSubject(subject), subject).toBe(true);
    }
  });

  it("leaves real work alone", () => {
    for (const subject of [
      "feat(agent): render the report to PDF",
      "fix(invoices): correct page breaks on multi-page bills",
      "add CSV export to the client list",
    ]) {
      expect(isNoiseSubject(subject), subject).toBe(false);
    }
  });
});

describe("filterUntrackedItems", () => {
  it("keeps a well-evidenced proposal", () => {
    const kept = filterUntrackedItems([item()], push, []);
    expect(kept).toHaveLength(1);
    expect(kept[0].title).toBe("Add PDF export to the agent report");
  });

  it("drops shas the push never contained, and the item with them", () => {
    // Partly hallucinated: the real sha survives and carries the item.
    const partly = filterUntrackedItems(
      [item({ shas: ["a1b2c3d4e5f", "ffffffffff0"] })],
      push,
      []
    );
    expect(partly).toHaveLength(1);
    expect(partly[0].shas).toEqual(["a1b2c3d4e5f"]);

    // Wholly hallucinated: no evidence left, so no proposal.
    expect(
      filterUntrackedItems([item({ shas: ["ffffffffff0"] })], push, [])
    ).toHaveLength(0);
    expect(filterUntrackedItems([item({ shas: [] })], push, [])).toHaveLength(0);
  });

  it("drops low confidence", () => {
    expect(filterUntrackedItems([item({ confidence: "low" })], push, [])).toHaveLength(0);
    expect(filterUntrackedItems([item({ confidence: "medium" })], push, [])).toHaveLength(1);
  });

  it("drops a proposal whose every commit is housekeeping", () => {
    expect(
      filterUntrackedItems(
        [item({ title: "Upgrade Next.js", shas: ["c3d4e5f6a7b", "d4e5f6a7b8c"] })],
        push,
        []
      )
    ).toHaveLength(0);

    // One real commit among the noise is still a deliverable.
    expect(
      filterUntrackedItems([item({ shas: ["c3d4e5f6a7b", "a1b2c3d4e5f"] })], push, [])
    ).toHaveLength(1);
  });

  it("drops a proposal that duplicates an existing task — including a done one", () => {
    // The premise of the whole scan: this push's work is finished, so the task
    // it would duplicate is a completed one the other guards can't see.
    const existing = [{ id: "t1", title: "Add PDF export to the agent report" }];
    expect(filterUntrackedItems([item()], push, existing)).toHaveLength(0);

    // Near-duplicate phrasing counts too — that's findSimilarTitles' job.
    expect(
      filterUntrackedItems([item()], push, [
        { id: "t2", title: "Add a PDF export for the agent report page" },
      ])
    ).toHaveLength(0);

    // An unrelated task in the same engagement is not a duplicate.
    expect(
      filterUntrackedItems([item()], push, [{ id: "t3", title: "Rework the billing screen" }])
    ).toHaveLength(1);
  });

  it("collapses two proposals for the same deliverable, keeping the first", () => {
    const kept = filterUntrackedItems(
      [
        item({ title: "Add PDF export to the agent report" }),
        item({ title: "Add a PDF export for the agent report", shas: ["b2c3d4e5f6a"] }),
      ],
      push,
      []
    );
    expect(kept).toHaveLength(1);
    expect(kept[0].title).toBe("Add PDF export to the agent report");
  });

  it("caps how many one push can propose", () => {
    const many = Array.from({ length: MAX_GAPS_PER_PUSH + 3 }, (_, i) =>
      item({ title: `Distinct deliverable number ${i} zebra${i}` })
    );
    expect(filterUntrackedItems(many, push, [])).toHaveLength(MAX_GAPS_PER_PUSH);
  });

  it("drops a title too short to be a task", () => {
    expect(filterUntrackedItems([item({ title: "  x " })], push, [])).toHaveLength(0);
  });
});
