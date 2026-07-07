-- ============================================================
-- Staging groups — builder-created, named buckets for organizing
-- completed work, separate from the git branch a task shipped on.
-- Scoped to one engagement (e.g. "Release 1.2", "QA batch"). A task
-- belongs to at most one group. Drives the "Group by: Staging"
-- view on /b/staging, and can be set alongside branch_name on an
-- approval task.
--
-- RLS mirrors tasks: any engagement member can read; only the
-- engagement's builder can create/rename/delete. Reuses the
-- is_engagement_member / is_engagement_builder helpers from 0001.
-- ============================================================

create table staging_groups (
  id             uuid         primary key default gen_random_uuid(),
  engagement_id  uuid         not null references engagements(id) on delete cascade,
  name           text         not null,
  sort_order     int          not null default 0,
  created_by     uuid         references profiles(id) on delete set null,
  created_at     timestamptz  not null default now()
);

create index staging_groups_engagement_idx
  on staging_groups (engagement_id);

alter table staging_groups enable row level security;

create policy "staging_groups_select" on staging_groups
  for select using (is_engagement_member(engagement_id));

create policy "staging_groups_insert" on staging_groups
  for insert with check (
    is_engagement_builder(engagement_id) and created_by = auth.uid()
  );

create policy "staging_groups_update" on staging_groups
  for update using (is_engagement_builder(engagement_id));

create policy "staging_groups_delete" on staging_groups
  for delete using (is_engagement_builder(engagement_id));

-- The group a done task is filed under. Nullable — most tasks have no
-- group. ON DELETE SET NULL so deleting a group un-assigns its tasks
-- rather than deleting them. Writes are covered by the existing
-- tasks_update_builder RLS policy.
alter table tasks
  add column if not exists staging_group_id uuid
    references staging_groups(id) on delete set null;

create index if not exists tasks_staging_group_idx
  on tasks (engagement_id, staging_group_id);
