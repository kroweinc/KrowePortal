-- ============================================================
-- Project context — structured inputs.
--
-- Replaces the single freeform `projects.context` notes box with
-- structured context: where the business lives (LinkedIn + website)
-- and supporting materials (pasted links + uploaded files).
--
--   • projects.linkedin_url / website_url  — scalar reference URLs
--   • project_materials                    — links + file uploads,
--                                            one row per material
--
-- `projects.context` is kept as the (now secondary) freeform notes
-- field. Materials mirror the task_attachments design (see
-- completed/0008 + completed/0013): one table holds both `link` and
-- `file` rows, files live in a private storage bucket, downloads use
-- admin signed URLs.
-- ============================================================

alter table projects
  add column if not exists linkedin_url text,
  add column if not exists website_url  text;

create table if not exists project_materials (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  uploaded_by   uuid not null references profiles(id),
  material_type text not null default 'file'
                check (material_type in ('link', 'file')),
  label         text,           -- link display label, or null
  file_name     text,           -- original file name (files only)
  url           text,           -- external URL (links only)
  storage_path  text unique,    -- bucket path (files only)
  mime_type     text,
  size_bytes    bigint check (size_bytes is null or (size_bytes > 0 and size_bytes <= 26214400)),
  created_at    timestamptz not null default now(),
  -- Referential integrity per type
  constraint project_material_type_fields_check check (
    (material_type = 'file' and storage_path is not null) or
    (material_type = 'link' and url is not null)
  )
);

create index project_materials_project_idx on project_materials (project_id, created_at desc);

alter table project_materials enable row level security;

-- Gated entirely on project ownership, reusing is_project_owner() from 0033_projects.
create policy "project_materials_select" on project_materials
  for select using (is_project_owner(project_id));
create policy "project_materials_insert" on project_materials
  for insert with check (uploaded_by = auth.uid() and is_project_owner(project_id));
create policy "project_materials_delete" on project_materials
  for delete using (is_project_owner(project_id));

-- ============================================================
-- Storage bucket + policies (private; downloads via admin signed URLs)
-- ============================================================

insert into storage.buckets (id, name, public)
values ('project-materials', 'project-materials', false)
on conflict (id) do nothing;

create policy "project_materials_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'project-materials'
    and auth.uid() is not null
  );

create policy "project_materials_storage_delete" on storage.objects
  for delete using (
    bucket_id = 'project-materials'
    and auth.uid() is not null
  );
