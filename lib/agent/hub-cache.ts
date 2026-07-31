"use client";

import { getAgentHubData } from "@/lib/actions/agent";
import type { AgentHubData } from "@/lib/agent/types";

/* ============================================================
   The agent hub's payload cache — written by whoever warms it,
   read by the console that paints it.

   The hub costs a server round trip the builder shouldn't have
   to watch. Opening the palette used to *start* that fetch, so
   the Context row sat on "Loading…" for the whole thing before
   the chips appeared. Nothing about the payload requires the
   palette to be open, though: the toolbar warms it on mount, so
   by the time ⌘K lands, `peekHub` almost always answers with no
   network at all and the revalidation runs behind the builder.

   Keyed by *requested scope* — the client id the caller asked
   for, or "" for "whatever the server picks by default". So a
   switch to another client caches under that client, and both
   switching back and later landing on its page are free.

   Module scope: survives the palette closing and every
   client-side navigation, and is dropped on a hard reload —
   where the warm-up simply runs again.
   ============================================================ */

const cache = new Map<string, AgentHubData>();
const inflight = new Map<string, Promise<AgentHubData>>();

/** Cache key for a scope. Both the palette host and the console derive the
    engagement id from the same path match, so they agree on it for free. */
export function hubKey(engagementId: string | null | undefined): string {
  return engagementId ?? "";
}

/** The last payload seen for this scope, or null. Paints; never fetches. */
export function peekHub(key: string): AgentHubData | null {
  return cache.get(key) ?? null;
}

/**
 * Fetch a scope, deduping against any request already in flight for it — a
 * warm-up the builder just raced by opening the palette, or React's
 * double-invoked effect in dev, both of which used to fire a second identical
 * round trip. Always revalidates; `peekHub` is the free read.
 */
export function loadHub(key: string): Promise<AgentHubData> {
  const pending = inflight.get(key);
  if (pending) return pending;

  const request = getAgentHubData(key || null)
    .then((hub) => {
      cache.set(key, hub);
      return hub;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, request);
  return request;
}

/** Warm a scope we expect to be asked for. No-op once it's cached. */
export function prefetchHub(key: string): void {
  if (cache.has(key)) return;
  void loadHub(key).catch(() => {
    // A warm-up that fails is not the builder's problem — it was speculative and
    // nothing is showing yet. The open re-requests and surfaces its own state.
  });
}
