-- ============================================================
-- Context chunks — full-text search column (hybrid retrieval, with 0066).
--
-- Pure-vector search (0060) misses exact terms: names, dollar amounts, IDs,
-- acronyms. Add a Postgres full-text index alongside the vector index so the
-- hybrid RPC (0066) can fuse semantic + keyword matches. A GENERATED column
-- maintains the tsvector automatically (no app code, backfills existing rows on
-- migration) and is independent of the embedding pipeline — no re-embedding.
-- ============================================================

alter table context_chunks
  add column if not exists content_tsv tsvector
  generated always as (to_tsvector('english', content)) stored;

-- The GIN build's memory scales with the existing text corpus and overruns the
-- 32 MB default maintenance_work_mem on small instances (build needs ~61 MB+).
-- Raise it for this connection only; CREATE INDEX in the same session uses it.
-- (Supabase forbids ALTER SYSTEM, but a session-level SET is allowed.)
set maintenance_work_mem = '256MB';

create index if not exists context_chunks_tsv_idx
  on context_chunks using gin (content_tsv);

reset maintenance_work_mem;
