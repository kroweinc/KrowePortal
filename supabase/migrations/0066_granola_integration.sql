-- ============================================================
-- Granola integration.
--
-- 1. granola_connections — one Granola Public API key per builder,
--    AES-256-GCM encrypted via lib/crypto.ts (same envelope as
--    github_connections.access_token from 0006). Includes phase-2
--    auto-sync bookkeeping columns (sync_enabled/last_synced_at/
--    sync_cursor) that stay unused until the cron poller ships.
--
-- 2. granola_imports — the authoritative dedupe ledger. A Granola note
--    may be imported into a project (as an SOP transcript) AND into an
--    engagement (as extracted tasks), but never twice into the same
--    container — enforced by partial unique indexes. Engagement imports
--    create N task rows with no single anchor, so the ledger is the only
--    record that a note was handled; the phase-2 poller reads it too.
--
-- 3. project_sop_transcripts gains a 'granola' source_type (plus the
--    originating note id) so imported calls flow into PRD/quote/contract
--    generation through the existing composeSopBlock path unchanged.
--
-- Keep columns in sync with GranolaConnection / GranolaImport /
-- ProjectSopTranscript in lib/types.ts.
-- ============================================================

-- 1. Connection (mirrors github_connections, 0006)
create table if not exists granola_connections (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references profiles(id) on delete cascade,
  api_key        text not null,  -- iv:tag:ciphertext envelope, never plaintext
  key_last4      text,           -- display-only masking ("grn_••••abcd")
  connected_at   timestamptz not null default now(),
  -- Phase-2 auto-sync state (cron poller); unused by the manual picker.
  sync_enabled   boolean not null default false,
  last_synced_at timestamptz,
  sync_cursor    text,
  unique (user_id)
);

alter table granola_connections enable row level security;

create policy "granola_connections_select" on granola_connections
  for select using (auth.uid() = user_id);
create policy "granola_connections_insert" on granola_connections
  for insert with check (auth.uid() = user_id);
create policy "granola_connections_update" on granola_connections
  for update using (auth.uid() = user_id);
create policy "granola_connections_delete" on granola_connections
  for delete using (auth.uid() = user_id);

-- 2. Import ledger
create table if not exists granola_imports (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references profiles(id) on delete cascade,
  granola_note_id    text not null,
  granola_note_title text,
  granola_created_at timestamptz,
  target_kind        text not null check (target_kind in ('project', 'engagement')),
  project_id         uuid references projects(id) on delete cascade,
  engagement_id      uuid references engagements(id) on delete cascade,
  -- Deleting the SOP row nulls this pointer; the ledger row itself is
  -- deleted alongside (see deleteSopTranscript) so the note can be re-imported.
  sop_transcript_id  uuid references project_sop_transcripts(id) on delete set null,
  tasks_created      integer not null default 0,
  imported_via       text not null default 'manual' check (imported_via in ('manual', 'cron')),
  created_at         timestamptz not null default now(),
  constraint granola_import_target_check check (
    (target_kind = 'project' and project_id is not null and engagement_id is null)
    or (target_kind = 'engagement' and engagement_id is not null and project_id is null)
  )
);

-- Per-container dedupe: same note may target a project AND an engagement,
-- never the same one twice.
create unique index granola_imports_project_uniq
  on granola_imports (granola_note_id, project_id) where project_id is not null;
create unique index granola_imports_engagement_uniq
  on granola_imports (granola_note_id, engagement_id) where engagement_id is not null;
create index granola_imports_user_idx on granola_imports (user_id, created_at desc);

alter table granola_imports enable row level security;

create policy "granola_imports_select" on granola_imports
  for select using (auth.uid() = user_id);
create policy "granola_imports_insert" on granola_imports
  for insert with check (auth.uid() = user_id);
create policy "granola_imports_delete" on granola_imports
  for delete using (auth.uid() = user_id);

-- 3. project_sop_transcripts: allow 'granola' as a source.
alter table project_sop_transcripts
  add column if not exists granola_note_id text;

-- The 0055 source_type check was an inline (auto-named) column constraint, so
-- drop every check referencing source_type by definition instead of guessing
-- names, then recreate both with the widened value set.
do $$
declare r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where rel.relname = 'project_sop_transcripts'
      and nsp.nspname = 'public'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%source_type%'
  loop
    execute format('alter table project_sop_transcripts drop constraint %I', r.conname);
  end loop;
end $$;

alter table project_sop_transcripts
  add constraint project_sop_transcripts_source_type_check
  check (source_type in ('file', 'paste', 'granola'));

-- A file-sourced transcript keeps its original; pasted/granola ones never do.
alter table project_sop_transcripts
  add constraint project_sop_source_fields_check check (
    (source_type = 'file' and storage_path is not null)
    or (source_type = 'paste' and storage_path is null)
    or (source_type = 'granola' and storage_path is null)
  );
