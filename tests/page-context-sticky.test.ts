import { describe, it, expect } from "vitest";
import { resolvePageContext } from "@/lib/agent/page-context";

// resolvePageContext decides a chat turn's effective page hint + viewed document
// against what the run already remembers. The bug it fixes: a follow-up that
// carries no page context (fired from the neutral agent workspace, where the
// client can't re-derive it) used to reset the chat's context to nothing — now it
// inherits the run's sticky value. `patch` must hold only what actually changed so
// the caller's single write never clobbers the untouched field.

const DOC = { kind: "prd", id: "d8192de4-ee80-4398-bfc1-14e2e08ce69d" } as const;
const OTHER_DOC = { kind: "quote", id: "ca0f1352-aa8d-4fdd-ba74-ed0900c12afc" } as const;

describe("resolvePageContext", () => {
  it("adopts + pins the page context on the first turn (nothing sticky yet)", () => {
    const r = resolvePageContext(
      { page: "the Tasks board", viewedDoc: DOC },
      { page: null, viewedDoc: null }
    );
    expect(r.page).toBe("the Tasks board");
    expect(r.viewedDoc).toEqual(DOC);
    expect(r.patch).toEqual({ page: "the Tasks board", viewedDoc: DOC });
  });

  it("inherits the run's sticky context when a follow-up supplies none", () => {
    // The regression: a follow-up from /b/agent/[runId] carries no page/doc.
    const r = resolvePageContext(
      { page: undefined, viewedDoc: undefined },
      { page: "the Documents area", viewedDoc: DOC }
    );
    expect(r.page).toBe("the Documents area");
    expect(r.viewedDoc).toEqual(DOC);
    // Nothing changed, so nothing is written.
    expect(r.patch).toEqual({});
  });

  it("writes no patch when the turn repeats the sticky context", () => {
    const r = resolvePageContext(
      { page: "the Tasks board", viewedDoc: DOC },
      { page: "the Tasks board", viewedDoc: DOC }
    );
    expect(r.patch).toEqual({});
    expect(r.page).toBe("the Tasks board");
    expect(r.viewedDoc).toEqual(DOC);
  });

  it("overrides when the builder moves to a new page / document", () => {
    const r = resolvePageContext(
      { page: "the Repo page", viewedDoc: OTHER_DOC },
      { page: "the Tasks board", viewedDoc: DOC }
    );
    expect(r.page).toBe("the Repo page");
    expect(r.viewedDoc).toEqual(OTHER_DOC);
    expect(r.patch).toEqual({ page: "the Repo page", viewedDoc: OTHER_DOC });
  });

  it("updates only the field that changed, keeping the other sticky", () => {
    // New page, same document → patch touches page only; the doc stays inherited.
    const r = resolvePageContext(
      { page: "the Repo page", viewedDoc: undefined },
      { page: "the Documents area", viewedDoc: DOC }
    );
    expect(r.patch).toEqual({ page: "the Repo page" });
    expect(r.page).toBe("the Repo page");
    expect(r.viewedDoc).toEqual(DOC);
  });

  it("detects a same-kind, different-id document as a change", () => {
    const nextPrd = { kind: "prd", id: "00000000-0000-4000-8000-000000000000" } as const;
    const r = resolvePageContext(
      { viewedDoc: nextPrd },
      { page: "the Documents area", viewedDoc: DOC }
    );
    expect(r.patch).toEqual({ viewedDoc: nextPrd });
    expect(r.viewedDoc).toEqual(nextPrd);
    expect(r.page).toBe("the Documents area");
  });
});
