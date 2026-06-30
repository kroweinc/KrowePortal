"use server";

import { getCurrentProfile } from "@/lib/auth";
import { getClient, assertEngagementBuilder } from "@/lib/context/access";
import { embedQuery } from "@/lib/ai/embeddings";
import { assertAiBudget } from "@/lib/ai/usage";
import { friendlyAiError } from "@/lib/ai/client";
import type { ContextItemKind } from "@/lib/types";

export interface ContextSearchHit {
  chunkId: string;
  contextItemId: string;
  chunkIndex: number;
  content: string;
  similarity: number;
  item: { id: string; kind: ContextItemKind | "unknown"; title: string };
}

interface MatchRow {
  chunk_id: string;
  context_item_id: string;
  chunk_index: number;
  content: string;
  similarity: number;
}

/**
 * Semantic search over a client's context. Embeds the query, runs the
 * match_context_chunks RPC (cosine, builder-only via RLS + the function guard),
 * then hydrates item metadata in a single follow-up query. Builder-only.
 */
export async function searchClientContext(
  engagementId: string,
  query: string,
  k = 8
): Promise<{ hits?: ContextSearchHit[]; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Unauthorized" };
  if (profile.role !== "builder") return { error: "Builder only." };
  if (!(await assertEngagementBuilder(engagementId, profile.id))) return { error: "Not your client." };

  const q = query.trim();
  if (!q) return { hits: [] };

  const budget = await assertAiBudget(profile.id);
  if (!budget.ok) return { error: budget.error };

  let embedding: number[];
  try {
    embedding = await embedQuery(q, {
      userId: profile.id,
      operation: "context_search",
      engagementId,
    });
  } catch (err) {
    return { error: friendlyAiError(err) };
  }

  const supabase = await getClient(profile.id);
  const { data, error } = await supabase.rpc("match_context_chunks", {
    p_engagement_id: engagementId,
    p_query_embedding: embedding,
    p_match_count: k,
  });
  if (error) return { error: error.message };

  const rows = (data ?? []) as MatchRow[];
  if (!rows.length) return { hits: [] };

  // Hydrate item metadata in one query.
  const itemIds = [...new Set(rows.map((r) => r.context_item_id))];
  const { data: items } = await supabase
    .from("context_items")
    .select("id, kind, title")
    .in("id", itemIds);
  const byId = new Map(
    (items ?? []).map((i) => [
      i.id as string,
      { id: i.id as string, kind: i.kind as ContextItemKind, title: i.title as string },
    ])
  );

  const hits: ContextSearchHit[] = rows.map((r) => ({
    chunkId: r.chunk_id,
    contextItemId: r.context_item_id,
    chunkIndex: r.chunk_index,
    content: r.content,
    similarity: r.similarity,
    item: byId.get(r.context_item_id) ?? { id: r.context_item_id, kind: "unknown", title: "(removed)" },
  }));

  return { hits };
}
