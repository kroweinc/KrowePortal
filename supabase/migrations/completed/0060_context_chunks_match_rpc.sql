-- ============================================================
-- Context chunks + semantic search (RAG over the Client Context Layer, 0059).
--
-- Each context_item's extracted text is split into overlapping chunks and each
-- chunk is embedded with OpenAI text-embedding-3-small (1536 dims). Chunks are
-- inserted only AFTER a successful embed, so `embedding` is NOT NULL; partial /
-- failed states live on context_items.embedding_status instead.
--
-- engagement_id is denormalized onto the chunk so the hot search path can both
-- filter and apply the builder-only RLS gate without a join back to
-- context_items.
-- ============================================================

create table if not exists context_chunks (
  id               uuid         primary key default gen_random_uuid(),
  context_item_id  uuid         not null references context_items(id) on delete cascade,
  engagement_id    uuid         not null references engagements(id) on delete cascade,
  chunk_index      integer      not null,
  content          text         not null,
  token_estimate   integer,
  embedding        vector(1536) not null,   -- text-embedding-3-small
  created_at       timestamptz  not null default now(),
  unique (context_item_id, chunk_index)
);

create index if not exists context_chunks_item_idx on context_chunks (context_item_id);
create index if not exists context_chunks_engagement_idx on context_chunks (engagement_id);

-- Approximate-nearest-neighbour index. ivfflat is broadly available on Supabase;
-- cosine ops to match unit-normalized OpenAI embeddings. lists=100 suits the
-- modest per-engagement scale. (Swap to `hnsw (embedding vector_cosine_ops)` if
-- the Postgres build has it enabled.)
create index if not exists context_chunks_embedding_idx
  on context_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

alter table context_chunks enable row level security;

create policy "context_chunks_select" on context_chunks
  for select using (is_engagement_builder(engagement_id));
create policy "context_chunks_insert" on context_chunks
  for insert with check (is_engagement_builder(engagement_id));
create policy "context_chunks_delete" on context_chunks
  for delete using (is_engagement_builder(engagement_id));

-- ============================================================
-- Semantic search RPC. SECURITY INVOKER (default) so the caller's RLS still
-- applies; the explicit is_engagement_builder() guard means even a service-role
-- caller can't read another engagement's chunks through this function.
-- <=> is cosine distance; similarity = 1 - distance.
-- ============================================================
create or replace function match_context_chunks(
  p_engagement_id   uuid,
  p_query_embedding vector(1536),
  p_match_count     int default 8
)
returns table (
  chunk_id        uuid,
  context_item_id uuid,
  chunk_index     int,
  content         text,
  similarity      float
)
language sql
stable
as $$
  select
    c.id,
    c.context_item_id,
    c.chunk_index,
    c.content,
    1 - (c.embedding <=> p_query_embedding) as similarity
  from context_chunks c
  where c.engagement_id = p_engagement_id
    and is_engagement_builder(c.engagement_id)
  order by c.embedding <=> p_query_embedding
  limit greatest(p_match_count, 1);
$$;
