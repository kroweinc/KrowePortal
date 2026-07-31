import type { ViewedDoc } from "@/lib/nav-commands";

// Pure resolution of a chat turn's effective page context — kept out of the SSE
// route (and free of server-only imports) so it's unit-testable. The route pairs
// it with setRunPageContext to persist the result.

/**
 * Resolve a turn's page hint + viewed document against what the run already
 * remembers (its sticky context). A turn that supplies a NEW page/document adopts
 * and pins it; a turn that supplies NONE inherits the run's sticky value — so a
 * follow-up (e.g. fired from the neutral agent workspace `/b/agent/[runId]`, where
 * the client can't re-derive them) keeps the chat's page context instead of
 * resetting it each turn. Mirrors how projectId is made sticky.
 *
 * `patch` holds only the fields that changed, so the caller writes at most once
 * and a page-only change never clobbers the sticky document (or vice-versa).
 */
export function resolvePageContext(
  incoming: { page?: string; viewedDoc?: ViewedDoc },
  sticky: { page?: string | null; viewedDoc?: ViewedDoc | null }
): {
  page?: string;
  viewedDoc?: ViewedDoc;
  patch: { page?: string; viewedDoc?: ViewedDoc };
} {
  const patch: { page?: string; viewedDoc?: ViewedDoc } = {};
  if (incoming.page && incoming.page !== sticky.page) {
    patch.page = incoming.page;
  }
  if (
    incoming.viewedDoc &&
    (incoming.viewedDoc.kind !== sticky.viewedDoc?.kind || incoming.viewedDoc.id !== sticky.viewedDoc?.id)
  ) {
    patch.viewedDoc = incoming.viewedDoc;
  }
  return {
    page: patch.page ?? sticky.page ?? undefined,
    viewedDoc: patch.viewedDoc ?? sticky.viewedDoc ?? undefined,
    patch,
  };
}
