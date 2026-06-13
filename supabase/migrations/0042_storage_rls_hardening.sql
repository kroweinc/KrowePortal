-- ============================================================
-- Storage RLS hardening — close the cross-user IDOR on three private
-- buckets.
--
-- The original policies authorized "any authenticated user" for
-- insert/delete on storage.objects, so a logged-in user could overwrite
-- or delete another user's task attachment, project material, or resume
-- by guessing/obtaining a path. App uploads use the RLS-bound client
-- (createClient), so these policies must still ALLOW the legitimate
-- owner's upload while blocking everyone else.
--
-- Object name (path) layouts, set by the upload actions:
--   • task-attachments :  tasks/<task_id>/<uuid>.<ext>
--   • project-materials:  projects/<project_id>/<uuid>.<ext>
--   • resumes          :  resumes/<user_id>/<uuid>.pdf
-- so (storage.foldername(name))[2] is the owning task / project / user.
--
-- Reuses is_engagement_member()/is_engagement_builder() (0001) and
-- project ownership (0033). Downloads are unaffected (admin signed URLs).
-- ============================================================

-- ---------- task-attachments ----------
drop policy if exists "task_attachments_storage_insert" on storage.objects;
drop policy if exists "task_attachments_storage_delete" on storage.objects;

create policy "task_attachments_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'task-attachments'
    and exists (
      select 1 from tasks t
      where t.id::text = (storage.foldername(name))[2]
        and (
          (t.engagement_id is not null and is_engagement_member(t.engagement_id))
          or (t.engagement_id is null and t.created_by = auth.uid())
        )
    )
  );

create policy "task_attachments_storage_delete" on storage.objects
  for delete using (
    bucket_id = 'task-attachments'
    and exists (
      select 1 from tasks t
      where t.id::text = (storage.foldername(name))[2]
        and (
          (t.engagement_id is not null and is_engagement_member(t.engagement_id))
          or (t.engagement_id is null and t.created_by = auth.uid())
        )
    )
  );

-- ---------- project-materials ----------
drop policy if exists "project_materials_storage_insert" on storage.objects;
drop policy if exists "project_materials_storage_delete" on storage.objects;

create policy "project_materials_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'project-materials'
    and exists (
      select 1 from projects p
      where p.id::text = (storage.foldername(name))[2]
        and p.owner_id = auth.uid()
    )
  );

create policy "project_materials_storage_delete" on storage.objects
  for delete using (
    bucket_id = 'project-materials'
    and exists (
      select 1 from projects p
      where p.id::text = (storage.foldername(name))[2]
        and p.owner_id = auth.uid()
    )
  );

-- ---------- resumes ----------
drop policy if exists "resumes_storage_insert" on storage.objects;
drop policy if exists "resumes_storage_delete" on storage.objects;

create policy "resumes_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'resumes'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy "resumes_storage_delete" on storage.objects
  for delete using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[2] = auth.uid()::text
  );
