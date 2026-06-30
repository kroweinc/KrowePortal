-- ============================================================
-- Context items — supersedence (keep retrieval citing the live version).
--
-- A project accumulates several quote / PRD / contract drafts; once one is
-- signed (or accepted, for quotes), the non-winning siblings are stale. Their
-- mirrors should stay visible for history (browse / graph) but must NOT surface
-- in semantic search, or an agent could cite an old draft's numbers over the
-- signed version. We mark such mirrors with superseded_at (see
-- reconcileDocSupersedence in lib/context/sync-document.ts) and exclude them
-- from the hybrid RPC by default.
-- ============================================================

alter table context_items add column if not exists superseded_at timestamptz;

-- Re-create the hybrid RPC with a superseded filter. Drop the old 5-arg
-- signature first so adding the new parameter doesn't leave a stale overload
-- that PostgREST could resolve ambiguously.
drop function if exists match_context_chunks_hybrid(uuid, vector, text, int, int);

create or replace function match_context_chunks_hybrid(
  p_engagement_id      uuid,
  p_query_embedding    vector(1536),
  p_query_text         text,
  p_match_count        int default 20,
  p_rrf_k              int default 60,
  p_include_superseded boolean default false
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
    join context_items ci on ci.id = c.context_item_id
    where c.engagement_id = p_engagement_id
      and is_engagement_builder(c.engagement_id)
      and (p_include_superseded or ci.superseded_at is null)
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
    from context_chunks c
    join context_items ci on ci.id = c.context_item_id
    cross join q
    where c.engagement_id = p_engagement_id
      and is_engagement_builder(c.engagement_id)
      and (p_include_superseded or ci.superseded_at is null)
      and q.tsq is not null
      and c.content_tsv @@ q.tsq
    order by ts_rank_cd(c.content_tsv, q.tsq) desc
    limit greatest(p_match_count, 1) * 4
  ),
  fused as (
    select
      coalesce(v.id, f.id)                           as chunk_id,
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
