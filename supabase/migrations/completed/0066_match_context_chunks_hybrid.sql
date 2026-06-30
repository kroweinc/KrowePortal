-- ============================================================
-- Hybrid semantic + keyword search over the Client Context Layer (0059/0060).
--
-- Runs a vector search (cosine, like match_context_chunks) AND a full-text
-- search (0065 content_tsv) over the engagement's chunks, then fuses the two
-- ranked lists with Reciprocal Rank Fusion (RRF): score = Σ 1/(k + rank_i).
-- RRF needs no score normalization across the two very different scales and is
-- robust when one modality misses entirely. Returns each chunk's raw similarity
-- + fts rank + fused score, plus its item kind / updated_at so the caller can
-- apply a light recency/importance rerank.
--
-- SECURITY INVOKER (default): the caller's RLS applies, and the explicit
-- is_engagement_builder() guard (in BOTH source CTEs) means even a service-role
-- caller can't read another engagement's chunks. The old match_context_chunks
-- (0060) is left in place as a fallback.
-- ============================================================

create or replace function match_context_chunks_hybrid(
  p_engagement_id   uuid,
  p_query_embedding vector(1536),
  p_query_text      text,
  p_match_count     int default 20,
  p_rrf_k           int default 60
)
returns table (
  chunk_id        uuid,
  context_item_id uuid,
  chunk_index     int,
  content         text,
  similarity      float,
  fts_rank        float,
  rrf_score       float,
  kind            text,
  item_updated_at timestamptz
)
language sql
stable
as $$
  with q as (
    select websearch_to_tsquery('english', coalesce(p_query_text, '')) as tsq
  ),
  vec as (
    select
      c.id,
      c.context_item_id,
      c.chunk_index,
      c.content,
      1 - (c.embedding <=> p_query_embedding) as similarity,
      row_number() over (order by c.embedding <=> p_query_embedding) as rank
    from context_chunks c
    where c.engagement_id = p_engagement_id
      and is_engagement_builder(c.engagement_id)
    order by c.embedding <=> p_query_embedding
    limit greatest(p_match_count, 1) * 4
  ),
  fts as (
    select
      c.id,
      c.context_item_id,
      c.chunk_index,
      c.content,
      ts_rank_cd(c.content_tsv, q.tsq) as fts_rank,
      row_number() over (order by ts_rank_cd(c.content_tsv, q.tsq) desc) as rank
    from context_chunks c, q
    where c.engagement_id = p_engagement_id
      and is_engagement_builder(c.engagement_id)
      and q.tsq is not null
      and c.content_tsv @@ q.tsq
    order by ts_rank_cd(c.content_tsv, q.tsq) desc
    limit greatest(p_match_count, 1) * 4
  ),
  fused as (
    select
      coalesce(v.id, f.id)                          as chunk_id,
      coalesce(v.context_item_id, f.context_item_id) as context_item_id,
      coalesce(v.chunk_index, f.chunk_index)         as chunk_index,
      coalesce(v.content, f.content)                 as content,
      coalesce(v.similarity, 0)                      as similarity,
      coalesce(f.fts_rank, 0)                        as fts_rank,
      coalesce(1.0 / (p_rrf_k + v.rank), 0)
        + coalesce(1.0 / (p_rrf_k + f.rank), 0)      as rrf_score
    from vec v
    full outer join fts f on v.id = f.id
  )
  select
    fused.chunk_id,
    fused.context_item_id,
    fused.chunk_index,
    fused.content,
    fused.similarity,
    fused.fts_rank,
    fused.rrf_score,
    ci.kind,
    ci.updated_at as item_updated_at
  from fused
  join context_items ci on ci.id = fused.context_item_id
  order by fused.rrf_score desc
  limit greatest(p_match_count, 1);
$$;
