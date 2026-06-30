-- ============================================================
-- Client Context Layer — engagement-scoped, BUILDER-ONLY store.
--
-- A single home for everything a builder knows about a client: uploaded
-- documents, SOPs, discovery transcripts, supporting materials, pasted
-- notes, and reference links. Unlike project_materials (0038) / SOP
-- transcripts (0055) — which hang off a builder's PROJECT — this hangs off
-- the ENGAGEMENT (the ongoing operator<->builder relationship that already
-- owns the tasks + linked GitHub repo). It is the foundation for future
-- LLM/agent features, so the extracted TEXT is stored here and chunked +
-- embedded in 0060.
--
-- NOTE — do NOT confuse with `context_materials` (0029). That table is
-- engagement-MEMBER readable (the operator sees it) and holds only
-- links/notes with no text/Aembeddings. THIS table is builder-only and powers
-- RAG; operators never see it. They are intentionally separate.
--
-- Files reuse the existing private `project-materials` bucket under
-- engagements/<engagement_id>/context/<uuid>.<ext>. The 0042 storage policy
-- only authorizes projects/<project_id>/… paths, so this migration adds a
-- parallel pair of storage policies for the engagements/ prefix, gated on the
-- engagement's builder. (Multiple permissive policies on storage.objects are
-- OR'd, so this does not weaken the existing project-materials policy.)
-- ============================================================

-- pgvector. On Supabase this installs into the `extensions` schema, which is on
-- the default search_path, so the `vector` type resolves unqualified below.
create extension if not exists vector;

create table if not exists context_items (
  id               uuid        primary key default gen_random_uuid(),
  engagement_id    uuid        not null references engagements(id) on delete cascade,
  created_by       uuid        not null references profiles(id),
  kind             text        not null
                   check (kind in ('document','sop','transcript','material','note','link')),
  title            text        not null,
  -- file source (document/sop/transcript/material uploaded as a file)
  file_name        text,
  storage_path     text unique,   -- engagements/<id>/context/<uuid>.<ext> in project-materials bucket
  mime_type        text,
  size_bytes       bigint        check (size_bytes is null or size_bytes > 0),
  -- link source
  url              text,
  -- extracted / pasted text — the canonical text the RAG layer chunks + embeds
  content          text,
  char_count       integer,
  -- freeform provenance, e.g. {"source":"upload","original_ext":".pdf"}
  source_meta      jsonb         not null default '{}'::jsonb,
  -- embedding lifecycle so the UI/queries can tell partial states apart
  embedding_status text          not null default 'pending'
                   check (embedding_status in ('pending','ready','failed','skipped')),
  chunk_count      integer       not null default 0,
  created_at       timestamptz   not null default now(),
  updated_at       timestamptz   not null default now()
);

create index if not exists context_items_engagement_idx
  on context_items (engagement_id, created_at desc);

alter table context_items enable row level security;

-- BUILDER-ONLY gate via is_engagement_builder() (0001). Mirrors the 0055 policy
-- form, swapping is_project_owner(project_id) -> is_engagement_builder(engagement_id).
create policy "context_items_select" on context_items
  for select using (is_engagement_builder(engagement_id));
create policy "context_items_insert" on context_items
  for insert with check (created_by = auth.uid() and is_engagement_builder(engagement_id));
create policy "context_items_update" on context_items
  for update using (is_engagement_builder(engagement_id))
             with check (is_engagement_builder(engagement_id));
create policy "context_items_delete" on context_items
  for delete using (is_engagement_builder(engagement_id));

-- ============================================================
-- Storage policies for the engagements/<id>/context/… path on the existing
-- project-materials bucket. Compares the table uuid (as text) to the folder
-- segment — no uuid cast of untrusted input — matching the 0042 hardening style.
-- ============================================================
create policy "context_items_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'project-materials'
    and (storage.foldername(name))[1] = 'engagements'
    and exists (
      select 1 from engagements e
      where e.id::text = (storage.foldername(name))[2]
        and e.builder_id = auth.uid()
    )
  );

create policy "context_items_storage_delete" on storage.objects
  for delete using (
    bucket_id = 'project-materials'
    and (storage.foldername(name))[1] = 'engagements'
    and exists (
      select 1 from engagements e
      where e.id::text = (storage.foldername(name))[2]
        and e.builder_id = auth.uid()
    )
  );
