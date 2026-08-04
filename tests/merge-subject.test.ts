import { describe, expect, it } from "vitest";
import {
  parseMergedBranch,
  parseMergeTarget,
  pickIntegrationBranches,
  mergeSubject,
} from "@/lib/github/merge-subject";

describe("parseMergedBranch (labeling a release from its merge commit)", () => {
  it("reads a plain local merge", () => {
    expect(parseMergedBranch("Merge branch 'dev'")).toBe("dev");
  });

  it("reads a local merge that names its target", () => {
    expect(parseMergedBranch("Merge branch 'dev' into main")).toBe("dev");
  });

  it("reads a remote-tracking merge, like parseMergeTarget does", () => {
    expect(
      parseMergedBranch("Merge remote-tracking branch 'origin/main' into Changelog")
    ).toBe("origin/main");
  });

  it("reads a GitHub PR merge", () => {
    expect(parseMergedBranch("Merge pull request #12 from Jynx-hub/dev")).toBe("dev");
  });

  it("keeps a slashed branch name intact", () => {
    expect(
      parseMergedBranch("Merge pull request #2 from Jynx-hub/claude/ptax-firm-error")
    ).toBe("claude/ptax-firm-error");
  });

  it("is null for an ordinary commit — a plain push names no branch", () => {
    expect(
      parseMergedBranch("fix(email): stop copying Kea's firm inbox on their agents' emails")
    ).toBeNull();
  });

  it("ignores the body and reads only the subject", () => {
    expect(parseMergedBranch("Merge branch 'dev'\n\nMerge branch 'other'")).toBe("dev");
  });
});

describe("parseMergeTarget (finding the integration branch)", () => {
  it("reads the branch a merge landed on", () => {
    expect(parseMergeTarget("Merge branch 'AgentPDF' into dev")).toBe("dev");
  });

  it("handles a remote-tracking merge", () => {
    expect(parseMergeTarget("Merge remote-tracking branch 'origin/x' into dev")).toBe(
      "dev"
    );
  });

  it("is null when git omitted the target (merge into the current branch)", () => {
    expect(parseMergeTarget("Merge branch 'dev'")).toBeNull();
  });

  it("is null for an ordinary commit", () => {
    expect(parseMergeTarget("feat(clio): surface the artifact registry")).toBeNull();
  });
});

describe("pickIntegrationBranches", () => {
  // The real shape of Jynx-hub/PatelInternal's main log.
  const log = [
    "fix(email): stop copying Kea's firm inbox on their agents' emails",
    "Merge branch 'AgentPDF' into dev",
    "feat(email): route Charles Denson petition notice to his firm address",
    "Merge branch 'ClioBilling' into dev",
    "feat(clio): put teardown behind a kill switch",
  ];

  it("finds dev from merge commits carried onto main", () => {
    expect(pickIntegrationBranches(log, "main", 3)).toEqual(["dev"]);
  });

  it("dedupes — dev merged twice is still one branch to scan", () => {
    expect(pickIntegrationBranches(log, "main", 3)).toHaveLength(1);
  });

  it("never returns the default branch itself", () => {
    expect(
      pickIntegrationBranches(["Merge branch 'dev' into main"], "main", 3)
    ).toEqual([]);
  });

  it("caps the list so the scan can't fan out per branch", () => {
    const many = ["a", "b", "c", "d"].map((t) => `Merge branch 'x' into ${t}`);
    expect(pickIntegrationBranches(many, "main", 2)).toEqual(["a", "b"]);
  });

  it("is empty for a log with no merge commits", () => {
    expect(pickIntegrationBranches(["fix: one", "feat: two"], "main", 3)).toEqual([]);
  });
});

describe("mergeSubject (the push's stored display label)", () => {
  it("takes the subject line and drops the body", () => {
    expect(
      mergeSubject("Merge branch 'AgentPDF' into dev\n\nMerge branch 'other' into x")
    ).toBe("Merge branch 'AgentPDF' into dev");
  });

  it("keeps a subject that names no branch at all — a plain push still has one", () => {
    expect(mergeSubject("fix(email): stop copying the firm inbox")).toBe(
      "fix(email): stop copying the firm inbox"
    );
    // ...which is exactly the case parseMergedBranch cannot label.
    expect(parseMergedBranch("fix(email): stop copying the firm inbox")).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(mergeSubject("  Merge branch 'dev'  \n\nbody")).toBe("Merge branch 'dev'");
  });

  it("is null for an empty message — the column rejects an empty string", () => {
    expect(mergeSubject("")).toBeNull();
    expect(mergeSubject("   \n  ")).toBeNull();
  });

  it("truncates to the column's 300-character cap", () => {
    const long = `feat: ${"x".repeat(400)}`;
    expect(mergeSubject(long)).toHaveLength(300);
  });
});
