// The PRD section the builder is currently looking at — a lightweight, submit-time
// signal, mirroring how the ⌘K omnibox reads the pathname to learn the viewed doc.
//
// The PRD dashboard's rail tracks its active section via scroll-spy (prd-rail.tsx)
// but that state lives deep in the dashboard subtree, while the agent surfaces (the
// omnibox, the thread) are siblings under AgentRunsProvider. Rather than thread a
// context across the whole tree for a value only read the instant a turn is fired,
// the rail writes it here and the agent surfaces read it on submit — the same
// derive-at-submit shape as resolveViewedDoc(pathname).
//
// It's stored WITH its PRD id so a reader can reject a stale section left over from
// a previously-viewed PRD: the section is only trusted when its prdId matches the
// PRD the turn is actually scoped to.

interface ViewedSection {
  prdId: string;
  sectionId: string;
}

let current: ViewedSection | null = null;

/** The rail calls this as the active section changes (keyed by the PRD in view). */
export function setViewedSection(prdId: string, sectionId: string): void {
  current = { prdId, sectionId };
}

/** Clear on unmount so a stale section never leaks onto a later, unrelated turn. */
export function clearViewedSection(prdId: string): void {
  if (current?.prdId === prdId) current = null;
}

/** The viewed section, or null. Callers verify prdId against the turn's viewed PRD. */
export function getViewedSection(): ViewedSection | null {
  return current;
}

/**
 * The section to attach to a turn given the document in view: only when the turn
 * is scoped to a PRD AND the stored section belongs to that same PRD — so a stale
 * section from a previously-open PRD (or a section while viewing a quote/contract)
 * never leaks onto the turn. Shared by the omnibox and the thread composer.
 */
export function sectionForViewedDoc(
  viewedDoc: { kind: "prd" | "quote" | "contract"; id: string } | null | undefined
): string | null {
  if (viewedDoc?.kind !== "prd") return null;
  return current?.prdId === viewedDoc.id ? current.sectionId : null;
}
