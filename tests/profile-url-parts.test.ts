import { describe, expect, it } from "vitest";
import {
  joinProfileUrl,
  splitProfileUrl,
  type ProfileLinkKind,
} from "@/lib/builder-profile/url-parts";

// The profile editor shows a fixed prefix beside a handle field, but the DB
// still stores whole URLs. These two functions are the only thing standing
// between "type your username" and a corrupted linkedin_url column.

describe("splitProfileUrl", () => {
  it("strips the expected prefix", () => {
    expect(splitProfileUrl("linkedin", "https://linkedin.com/in/ridpat")).toBe("ridpat");
    expect(splitProfileUrl("github", "https://github.com/riddhimapatllollu")).toBe(
      "riddhimapatllollu"
    );
    expect(splitProfileUrl("portfolio", "https://riddhimap.com")).toBe("riddhimap.com");
  });

  it("tolerates www, http, and a trailing slash", () => {
    expect(splitProfileUrl("linkedin", "http://www.linkedin.com/in/ridpat/")).toBe("ridpat");
    expect(splitProfileUrl("github", "www.github.com/octocat")).toBe("octocat");
  });

  it("returns the whole URL when it doesn't sit under the prefix", () => {
    // A company page, not a personal profile — mangling this into a handle
    // would silently rewrite the builder's link.
    const company = "https://linkedin.com/company/krowe";
    expect(splitProfileUrl("linkedin", company)).toBe(company);
  });

  it("is empty for empty input", () => {
    expect(splitProfileUrl("linkedin", "")).toBe("");
    expect(splitProfileUrl("portfolio", "   ")).toBe("");
  });
});

describe("joinProfileUrl", () => {
  it("prefixes a bare handle", () => {
    expect(joinProfileUrl("linkedin", "ridpat")).toBe("https://linkedin.com/in/ridpat");
    expect(joinProfileUrl("github", "octocat")).toBe("https://github.com/octocat");
    expect(joinProfileUrl("portfolio", "riddhimap.com")).toBe("https://riddhimap.com");
  });

  it("passes through a value that already carries a scheme", () => {
    const company = "https://linkedin.com/company/krowe";
    expect(joinProfileUrl("linkedin", company)).toBe(company);
  });

  it("does not nest a foreign host under our prefix", () => {
    // Typed into the LinkedIn field, this is a link somewhere else — it must
    // reach the server whole so the domain check can reject it with a real
    // message, not become linkedin.com/in/example.com/me.
    expect(joinProfileUrl("linkedin", "example.com/me")).toBe("https://example.com/me");
  });

  it("clears to empty rather than storing a bare prefix", () => {
    expect(joinProfileUrl("linkedin", "")).toBe("");
    expect(joinProfileUrl("github", "  ")).toBe("");
  });

  it("round-trips every kind", () => {
    const cases: [ProfileLinkKind, string][] = [
      ["linkedin", "https://linkedin.com/in/ridpat"],
      ["github", "https://github.com/octocat"],
      ["portfolio", "https://riddhimap.com"],
      ["linkedin", "https://linkedin.com/company/krowe"],
    ];
    for (const [kind, url] of cases) {
      expect(joinProfileUrl(kind, splitProfileUrl(kind, url))).toBe(url);
    }
  });

  it("survives a second edit of a passed-through value", () => {
    // The bug this guards: split() surfaces a full URL verbatim, the builder
    // edits one character, join() must not prepend the prefix to it.
    const shown = splitProfileUrl("linkedin", "https://linkedin.com/company/krowe");
    expect(joinProfileUrl("linkedin", shown.replace("krowe", "krowe2"))).toBe(
      "https://linkedin.com/company/krowe2"
    );
  });
});
