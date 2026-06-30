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

interface HybridMatchRow {
  chunk_id: string;
  context_item_id: string;
  chunk_index: number;
  content: string;
  similarity: number;
  fts_rank: number;
  rrf_score: number;
  kind: string;
  item_updated_at: string | null;
}

// Light rerank over the fused (RRF) candidates: nudge by item recency and a
// small per-kind importance weight so semantic/keyword relevance stays primary
// while fresher, higher-signal artifacts (briefs, change orders, the agreement)
// edge out stale notes/links on ties. Weights are deliberately gentle.
const KIND_WEIGHT: Record<string, number> = {
  brief: 1.1,
  change_order: 1.1,
  agreement: 1.1,
  contract: 1.05,
  quote: 1.05,
  prd: 1.05,
  sop: 1.05,
  transcript: 1.05,
  document: 1.0,
  task: 1.0,
  milestone: 1.0,
  deliverable: 1.0,
  task_attachment: 1.0, // first-party task evidence — neutral, above generic material
  codebase: 0.95,
  infra: 0.9,
  profile: 0.9,
  note: 0.9,
  material: 0.85,
  availability: 0.8,
  link: 0.8,
};
const RECENCY_WEIGHT = 0.01; // ~ one RRF rank position at most

function rerankScore(row: HybridMatchRow): number {
  const kindWeight = KIND_WEIGHT[row.kind] ?? 1.0;
  let recency = 0;
  if (row.item_updated_at) {
    const ageDays = (Date.now() - new Date(row.item_updated_at).getTime()) / 86_400_000;
    recency = RECENCY_WEIGHT / (1 + Math.max(0, ageDays) / 30);
  }
  return row.rrf_score * kindWeight + recency;
}

/**
 * Hybrid search over a client's context: embeds the query, runs
 * match_context_chunks_hybrid (vector + full-text fused with RRF, builder-only
 * via RLS + the function guard), applies a light recency/kind rerank, then
 * hydrates item metadata. Builder-only.
 *
 * `k` is adaptive when omitted — scaled to the engagement's corpus size so a
 * large document isn't mostly unseen — and clamped to [8, 40].
 */
export async function searchClientContext(
  engagementId: string,
  query: string,
  k?: number
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

  // Adaptive top-k: scale to corpus size (≈15% of chunks) so large documents
  // aren't ~98% unseen, clamped to a sane window. Explicit k overrides.
  let topK = k;
  if (topK == null) {
    const { count } = await supabase
      .from("context_chunks")
      .select("id", { count: "exact", head: true })
      .eq("engagement_id", engagementId);
    topK = Math.min(40, Math.max(8, Math.ceil((count ?? 0) * 0.15)));
  }
  // Pull a few extra candidates so the rerank has room to reorder.
  const candidateCount = Math.min(80, Math.max(topK * 3, topK));

  const { data, error } = await supabase.rpc("match_context_chunks_hybrid", {
    p_engagement_id: engagementId,
    p_query_embedding: embedding,
    p_query_text: q,
    p_match_count: candidateCount,
  });

  if (!error) {
    const rows = (data ?? []) as HybridMatchRow[];
    if (!rows.length) return { hits: [] };
    // Rerank the fused candidates, then take the top-k.
    const ranked = [...rows].sort((a, b) => rerankScore(b) - rerankScore(a)).slice(0, topK);
    return { hits: await hydrate(supabase, ranked) };
  }

  // Fallback: hybrid RPC not deployed yet (migration 0066) — degrade to the
  // legacy vector-only search so search never breaks during rollout.
  const legacy = await supabase.rpc("match_context_chunks", {
    p_engagement_id: engagementId,
    p_query_embedding: embedding,
    p_match_count: topK,
  });
  if (legacy.error) return { error: legacy.error.message };
  const legacyRows = (legacy.data ?? []) as Array<{
    chunk_id: string;
    context_item_id: string;
    chunk_index: number;
    content: string;
    similarity: number;
  }>;
  if (!legacyRows.length) return { hits: [] };
  return { hits: await hydrate(supabase, legacyRows) };
}

type RankedRow = {
  chunk_id: string;
  context_item_id: string;
  chunk_index: number;
  content: string;
  similarity: number;
  kind?: string;
};

/** Hydrate item titles (one query) and shape rows into ContextSearchHit[]. */
async function hydrate(
  supabase: Awaited<ReturnType<typeof getClient>>,
  rows: RankedRow[]
): Promise<ContextSearchHit[]> {
  const itemIds = [...new Set(rows.map((r) => r.context_item_id))];
  const { data: items } = await supabase.from("context_items").select("id, kind, title").in("id", itemIds);
  const byId = new Map(
    (items ?? []).map((i) => [
      i.id as string,
      { id: i.id as string, kind: i.kind as ContextItemKind, title: i.title as string },
    ])
  );
  return rows.map((r) => ({
    chunkId: r.chunk_id,
    contextItemId: r.context_item_id,
    chunkIndex: r.chunk_index,
    content: r.content,
    similarity: r.similarity,
    item:
      byId.get(r.context_item_id) ??
      { id: r.context_item_id, kind: (r.kind as ContextItemKind) ?? "unknown", title: "(removed)" },
  }));
}
