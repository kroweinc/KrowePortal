-- ============================================================
-- Task comments — the chat thread in the task detail sheet.
--
-- A plain conversation between the engagement's builder and operator,
-- scoped to one task. Renders in the sheet's Comments tab (and as a
-- one-row preview on Overview), interleaved with the approval-loop
-- events already recorded in task_audit_log — this table holds only
-- what people typed, never the lifecycle events.
--
-- Soft delete: removing a comment stamps deleted_at rather than
-- deleting the row, so a thread that was replied to keeps its shape
-- and the UI can render a "comment removed" placeholder in place.
-- updated_at is null until the first edit — it doubles as the flag
-- behind the "edited" tag, which is why it has no default.
-- ============================================================

create table if not exists task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references tasks(id) on delete cascade,
  author_id  uuid not null references profiles(id),
  body       text not null check (length(btrim(body)) > 0 and length(body) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  deleted_at timestamptz
);

create index if not exists task_comments_task_id_idx
  on task_comments (task_id, created_at);

alter table task_comments enable row level security;

-- SELECT: visible whenever the parent task is (same shape as the child-table
-- policies recreated in 0054, with no operator_visible gate).
create policy "task_comments_select" on task_comments
  for select using (
    exists (
      select 1 from tasks t
      where t.id = task_id
        and (
          (t.engagement_id is not null and is_engagement_member(t.engagement_id))
          or (t.engagement_id is null and t.created_by = auth.uid())
        )
    )
  );

-- INSERT: task members can post; must attribute the comment to themselves.
create policy "task_comments_insert" on task_comments
  for insert with check (
    author_id = auth.uid()
    and exists (
      select 1 from tasks t
      where t.id = task_id
        and (
          (t.engagement_id is not null and is_engagement_member(t.engagement_id))
          or (t.engagement_id is null and t.created_by = auth.uid())
        )
    )
  );

-- UPDATE: authors only — this covers both editing the body and the soft
-- delete. A builder cannot rewrite the operator's words, or vice versa.
create policy "task_comments_update" on task_comments
  for update using (author_id = auth.uid())
  with check (author_id = auth.uid());

-- No DELETE policy: rows are never hard-deleted from the app (the cascade
-- from tasks still applies).
