import { describe, expect, it } from "vitest";
import { pickPushFiles, type GhFile } from "@/lib/github/push-contents";

const file = (filename: string, additions = 0, deletions = 0): GhFile => ({
  filename,
  status: "modified",
  additions,
  deletions,
});

describe("pickPushFiles", () => {
  it("keeps everything, in order, when the push is small", () => {
    const files = [file("b.ts", 1), file("a.ts", 90), file("c.ts", 4)];
    const { files: picked, truncated } = pickPushFiles(files, 10);
    expect(truncated).toBe(false);
    expect(picked.map((f) => f.path)).toEqual(["b.ts", "a.ts", "c.ts"]);
  });

  it("computes churn from additions plus deletions", () => {
    const { files: picked } = pickPushFiles([file("a.ts", 12, 7)], 10);
    expect(picked[0]).toEqual({ path: "a.ts", status: "modified", churn: 19 });
  });

  it("treats missing counts as zero rather than NaN", () => {
    const { files: picked } = pickPushFiles([{ filename: "a.ts", status: "added" }], 10);
    expect(picked[0].churn).toBe(0);
  });

  it("keeps the biggest changes when it has to cut, not the alphabetical head", () => {
    // GitHub returns files alphabetically, so a plain slice on a wide push keeps
    // everything under a/ and drops the route that explains what shipped.
    const files = [
      file("a/one.ts", 1),
      file("a/two.ts", 2),
      file("z/app/api/agent/pdf/route.ts", 400),
    ];
    const { files: picked, truncated } = pickPushFiles(files, 2);
    expect(truncated).toBe(true);
    expect(picked.map((f) => f.path)).toEqual(["z/app/api/agent/pdf/route.ts", "a/two.ts"]);
  });

  it("does not flag truncation at exactly the cap", () => {
    const { truncated } = pickPushFiles([file("a.ts"), file("b.ts")], 2);
    expect(truncated).toBe(false);
  });

  it("handles an empty file list", () => {
    expect(pickPushFiles([], 10)).toEqual({ files: [], truncated: false });
  });
});
