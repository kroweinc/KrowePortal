-- ============================================================
-- Task Attachments — optional file uploads per task
-- ============================================================

create table if not exists task_attachments (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid not null references tasks(id) on delete cascade,
  uploaded_by   uuid not null references profiles(id),
  file_name     text not null,
  storage_path  text not null unique,
  mime_type     text not null,
  size_bytes    bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  created_at    timestamptz not null default now()
);

create index task_attachments_task_id_idx on task_attachments(task_id);

alter table task_attachments enable row level security;

-- SELECT: visible when the parent task is visible to the viewer
create policy "task_attachments_select" on task_attachments
  for select using (
    exists (
      select 1 from tasks t
      where t.id = task_id
        and (
          (t.engagement_id is not null
            and is_engagement_member(t.engagement_id)
            and (t.operator_visible = true or is_engagement_builder(t.engagement_id)))
          or (t.engagement_id is null and t.created_by = auth.uid())
        )
    )
  );

-- INSERT: engagement members can attach; must set uploaded_by to self
create policy "task_attachments_insert" on task_attachments
  for insert with check (
    uploaded_by = auth.uid()
    and exists (
      select 1 from tasks t
      where t.id = task_id
        and (
          (t.engagement_id is not null and is_engagement_member(t.engagement_id))
          or (t.engagement_id is null and t.created_by = auth.uid())
        )
    )
  );

-- DELETE: builder can delete any attachment on their engagement;
--         operator can only delete their own uploads;
--         personal task creator can delete any
create policy "task_attachments_delete" on task_attachments
  for delete using (
    exists (
      select 1 from tasks t
      where t.id = task_id
        and (
          (t.engagement_id is not null and is_engagement_builder(t.engagement_id))
          or (t.engagement_id is not null and is_engagement_member(t.engagement_id) and uploaded_by = auth.uid())
          or (t.engagement_id is null and t.created_by = auth.uid())
        )
    )
  );

-- ============================================================
-- Storage bucket + policies
-- ============================================================

insert into storage.buckets (id, name, public)
values ('task-attachments', 'task-attachments', false)
on conflict (id) do nothing;

-- Authenticated users may upload; deeper auth enforced at the DB layer above
create policy "task_attachments_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'task-attachments'
    and auth.uid() is not null
  );

-- Authenticated users may delete; deeper auth enforced at the DB layer above
create policy "task_attachments_storage_delete" on storage.objects
  for delete using (
    bucket_id = 'task-attachments'
    and auth.uid() is not null
  );
