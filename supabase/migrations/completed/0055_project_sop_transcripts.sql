-- ============================================================
-- Project SOP / Discovery Call Transcripts.
--
-- A project can have one or more discovery-call transcripts (SOPs) the
-- builder pastes or uploads. Unlike project_materials — where only the
-- file *name* is surfaced to the AI — the transcript's TEXT is extracted
-- on upload and stored in `content`, because that text IS the discovery
-- source the PRD/quote/contract generators read.
--
-- Mirrors the project_materials design (0038 + 0042 hardening): one row
-- per transcript, original files (when uploaded) live in the existing
-- private `project-materials` bucket under projects/<project_id>/sop/…,
-- downloads use admin signed URLs. RLS is gated entirely on project
-- ownership via is_project_owner() (0033).
--
-- No new storage bucket/policy: the 0042 project-materials storage policy
-- authorizes on (storage.foldername(name))[2] = <project_id> + owner, which
-- still matches the deeper projects/<project_id>/sop/<uuid>.<ext> path.
-- ============================================================

create table if not exists project_sop_transcripts (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  uploaded_by  uuid not null references profiles(id),
  label        text,           -- builder name, derived filename, or "Pasted transcript"
  source_type  text not null default 'file'
               check (source_type in ('file', 'paste')),
  file_name    text,           -- original file name (file source only)
  storage_path text unique,    -- original file in project-materials bucket (file source only)
  mime_type    text,
  content      text not null,  -- extracted/pasted transcript text — what the AI reads
  char_count   integer,
  created_at   timestamptz not null default now(),
  -- A file-sourced transcript keeps its original; a pasted one never does.
  constraint project_sop_source_fields_check check (
    (source_type = 'file' and storage_path is not null) or
    (source_type = 'paste' and storage_path is null)
  )
);

create index project_sop_transcripts_project_idx
  on project_sop_transcripts (project_id, created_at desc);

alter table project_sop_transcripts enable row level security;

-- Gated entirely on project ownership, reusing is_project_owner() from 0033_projects.
create policy "project_sop_transcripts_select" on project_sop_transcripts
  for select using (is_project_owner(project_id));
create policy "project_sop_transcripts_insert" on project_sop_transcripts
  for insert with check (uploaded_by = auth.uid() and is_project_owner(project_id));
create policy "project_sop_transcripts_delete" on project_sop_transcripts
  for delete using (is_project_owner(project_id));
