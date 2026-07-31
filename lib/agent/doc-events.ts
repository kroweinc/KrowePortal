import { useEffect, useRef } from "react";

// ============================================================================
// Live document edits — the same-tab bridge that lets the agent's confirmed doc
// edit show up on the open document in real time, with no reload.
//
// The agent surface (⌘K palette, the floating dock, the /b/agent hub) and the
// document dashboards (PRD / quote / contract) live in ONE React tree under
// AgentRunsProvider. When a builder confirms a doc edit while looking at that
// document, the write tool persists the new content server-side and returns it;
// confirmToolCall hands it back to the client, agent-thread `publishDocEdit`s it,
// and the open dashboard — subscribed via useAgentDocEdit — merges it into local
// state. A DOM CustomEvent is the lightest bridge across the two sibling
// subtrees; no new provider, works on every builder route.
//
// The payload is exactly what was persisted (kind + id + title + content), so the
// dashboard rebaselines its autosave to it (reads "Saved", never re-writes an
// identical body). This handles the primary case — the builder watching their own
// doc; a doc opened later just loads fresh from the DB, already correct.
// ============================================================================

export type DocEditKind = "prd" | "quote" | "contract";

export interface DocEditEvent {
  kind: DocEditKind;
  id: string;
  title: string;
  content: Record<string, unknown>;
}

const EVENT_NAME = "krowe:agent-doc-edit";

/** Announce a freshly-persisted agent edit to any open view of that document. */
export function publishDocEdit(detail: DocEditEvent): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<DocEditEvent>(EVENT_NAME, { detail }));
}

/** Low-level subscribe; returns an unsubscribe. Prefer useAgentDocEdit in views. */
export function subscribeDocEdit(handler: (detail: DocEditEvent) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (ev: Event) => handler((ev as CustomEvent<DocEditEvent>).detail);
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}

/**
 * Subscribe a document view to agent edits that target it. When the agent's
 * confirmed edit lands on THIS doc (matching kind + id), `onEdit` fires with the
 * freshly-persisted content and title so the view reflects it live. `onEdit` is
 * held in a ref so callers can pass a fresh closure each render without
 * re-subscribing.
 */
export function useAgentDocEdit(
  target: { kind: DocEditKind; id: string },
  onEdit: (content: Record<string, unknown>, title: string) => void
): void {
  const onEditRef = useRef(onEdit);
  onEditRef.current = onEdit;
  useEffect(
    () =>
      subscribeDocEdit((e) => {
        if (e.kind === target.kind && e.id === target.id) onEditRef.current(e.content, e.title);
      }),
    [target.kind, target.id]
  );
}
