import { describe, expect, it } from "vitest";
import {
  normalizeBranchKey,
  validateBranchName,
  reconcileLocalBranches,
} from "@/lib/tasks/local-branches";

describe("normalizeBranchKey", () => {
  it("ignores case and separator style", () => {
    const key = normalizeBranchKey("feature/add-login");
    expect(normalizeBranchKey("Feature/Add-Login")).toBe(key);
    expect(normalizeBranchKey("feature_add_login")).toBe(key);
    expect(normalizeBranchKey("feature/add.login")).toBe(key);
  });

  it("drops the refs/heads prefix and surrounding noise", () => {
    expect(normalizeBranchKey("refs/heads/dev")).toBe("dev");
    expect(normalizeBranchKey("  dev  ")).toBe("dev");
    expect(normalizeBranchKey("--dev--")).toBe("dev");
  });

  it("keeps genuinely different branches apart", () => {
    expect(normalizeBranchKey("fix/login")).not.toBe(normalizeBranchKey("fix/logout"));
    expect(normalizeBranchKey("dev")).not.toBe(normalizeBranchKey("dev2"));
  });
});

describe("validateBranchName", () => {
  it("accepts ordinary branch names", () => {
    for (const name of ["dev", "feature/checkout-fix", "fix/PG-1042", "v2.1"]) {
      expect(validateBranchName(name)).toEqual({ name });
    }
  });

  it("trims and strips a pasted refs/heads prefix", () => {
    expect(validateBranchName("  refs/heads/dev  ")).toEqual({ name: "dev" });
  });

  it("rejects what git itself would reject", () => {
    const bad = [
      "",
      "   ",
      "ship emails",
      "feature~1",
      "feature^",
      "feature:x",
      "feature?",
      "feature*",
      "feature[x",
      "feature\\x",
      "feature..x",
      "feature@{1}",
      "/leading",
      "trailing/",
      "double//slash",
      "trailing.",
      "feature/.hidden",
      "feature/thing.lock",
      "a".repeat(201),
    ];
    for (const name of bad) {
      const result = validateBranchName(name);
      expect(result, name).toHaveProperty("error");
    }
  });
});

describe("reconcileLocalBranches", () => {
  it("adopts a local branch GitHub now lists under the same name", () => {
    const res = reconcileLocalBranches(["feature/checkout"], ["main", "feature/checkout"]);
    expect(res).toEqual({ adopted: ["feature/checkout"], renamed: [], kept: [] });
  });

  it("renames a local branch onto the spelling GitHub ended up with", () => {
    const res = reconcileLocalBranches(["Feature/Checkout Fix"], ["main", "feature/checkout-fix"]);
    expect(res.renamed).toEqual([
      { from: "Feature/Checkout Fix", to: "feature/checkout-fix" },
    ]);
    expect(res.adopted).toEqual([]);
    expect(res.kept).toEqual([]);
  });

  it("leaves a still-unpushed branch alone", () => {
    const res = reconcileLocalBranches(["wip/spike"], ["main", "dev"]);
    expect(res).toEqual({ adopted: [], renamed: [], kept: ["wip/spike"] });
  });

  it("collapses two spellings of one branch onto the same GitHub name", () => {
    const res = reconcileLocalBranches(
      ["ship_emails", "Ship-Emails"],
      ["main", "ship-emails"]
    );
    expect(res.renamed).toEqual([
      { from: "ship_emails", to: "ship-emails" },
      { from: "Ship-Emails", to: "ship-emails" },
    ]);
  });

  it("prefers the earlier GitHub name when two of them share a key", () => {
    // orderNames hands us the default branch first, then alphabetical — so the
    // winner is stable across syncs rather than whatever the API returned first.
    const res = reconcileLocalBranches(["fix login"], ["fix-login", "fix/login"]);
    expect(res.renamed).toEqual([{ from: "fix login", to: "fix-login" }]);
  });

  it("handles an empty GitHub listing without touching anything", () => {
    const res = reconcileLocalBranches(["wip"], []);
    expect(res).toEqual({ adopted: [], renamed: [], kept: ["wip"] });
  });
});
