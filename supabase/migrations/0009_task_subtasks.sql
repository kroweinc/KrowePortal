-- ============================================================
-- Task Subtasks — lightweight checklist items per task
-- ============================================================

create table if not exists task_subtasks (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references tasks(id) on delete cascade,
  created_by   uuid not null references profiles(id),
  title        text not null check (char_length(title) between 1 and 300),
  completed    boolean not null default false,
  position     integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index task_subtasks_task_id_idx on task_subtasks(task_id);

alter table task_subtasks enable row level security;

-- SELECT: visible when the parent task is visible to the viewer
create policy "task_subtasks_select" on task_subtasks
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

-- INSERT: engagement members can add; personal task creator can add; must set created_by to self
create policy "task_subtasks_insert" on task_subtasks
  for insert with check (
    created_by = auth.uid()
    and exists (
      select 1 from tasks t
      where t.id = task_id
        and (
          (t.engagement_id is not null and is_engagement_member(t.engagement_id))
          or (t.engagement_id is null and t.created_by = auth.uid())
        )
    )
  );

-- UPDATE: any engagement member (operator or builder) can toggle/edit; personal task creator can update
create policy "task_subtasks_update" on task_subtasks
  for update using (
    exists (
      select 1 from tasks t
      where t.id = task_id
        and (
          (t.engagement_id is not null and is_engagement_member(t.engagement_id))
          or (t.engagement_id is null and t.created_by = auth.uid())
        )
    )
  );

-- DELETE: any engagement member can delete; personal task creator can delete
create policy "task_subtasks_delete" on task_subtasks
  for delete using (
    exists (
      select 1 from tasks t
      where t.id = task_id
        and (
          (t.engagement_id is not null and is_engagement_member(t.engagement_id))
          or (t.engagement_id is null and t.created_by = auth.uid())
        )
    )
  );
