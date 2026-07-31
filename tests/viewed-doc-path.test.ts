import { describe, it, expect } from "vitest";
import { resolveViewedDoc } from "@/lib/nav-commands";

// resolveViewedDoc parses the specific document a builder is viewing from the URL
// so the agent can assume it for an untitled "change the document" request. The
// subtle bits: the quotes route is plural but the kind is singular, and the `/new`
// draft routes must NOT resolve (their id segment isn't a document id).

const PID = "ca0f1352-aa8d-4fdd-ba74-ed0900c12afc";
const DID = "d8192de4-ee80-4398-bfc1-14e2e08ce69d";

describe("resolveViewedDoc", () => {
  it("resolves a PRD document page", () => {
    expect(resolveViewedDoc(`/b/projects/${PID}/prd/${DID}`)).toEqual({ kind: "prd", id: DID });
  });

  it("maps the plural quotes route to the singular quote kind", () => {
    expect(resolveViewedDoc(`/b/projects/${PID}/quotes/${DID}`)).toEqual({ kind: "quote", id: DID });
  });

  it("resolves a contract document page", () => {
    expect(resolveViewedDoc(`/b/projects/${PID}/contract/${DID}`)).toEqual({ kind: "contract", id: DID });
  });

  it("does not resolve the New-document routes (no real doc in view)", () => {
    expect(resolveViewedDoc(`/b/projects/${PID}/prd/new`)).toBeNull();
    expect(resolveViewedDoc(`/b/projects/${PID}/quotes/new`)).toBeNull();
  });

  it("does not resolve the project overview or non-document pages", () => {
    expect(resolveViewedDoc(`/b/projects/${PID}`)).toBeNull();
    expect(resolveViewedDoc("/b")).toBeNull();
    expect(resolveViewedDoc(null)).toBeNull();
    expect(resolveViewedDoc(undefined)).toBeNull();
  });
});
