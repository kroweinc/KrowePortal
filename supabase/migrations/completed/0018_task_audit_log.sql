-- ============================================================
-- Task Audit Log — append-only history of task / subtask /
-- attachment changes. One row per discrete user action.
-- ============================================================

create table if not exists task_audit_log (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references tasks(id) on delete cascade,
  subtask_id  uuid references task_subtasks(id) on delete set null,
  actor_id    uuid not null references profiles(id),
  action      text not null,
  field       text,
  old_value   jsonb,
  new_value   jsonb,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists task_audit_log_task_id_created_idx
  on task_audit_log(task_id, created_at desc);

alter table task_audit_log enable row level security;

-- SELECT: viewer must be able to see the parent task
-- (same rule as task_subtasks_select in 0009)
create policy "task_audit_log_select" on task_audit_log
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

-- INSERT: engagement members can insert; actor_id must be self
create policy "task_audit_log_insert" on task_audit_log
  for insert with check (
    actor_id = auth.uid()
    and exists (
      select 1 from tasks t
      where t.id = task_id
        and (
          (t.engagement_id is not null and is_engagement_member(t.engagement_id))
          or (t.engagement_id is null and t.created_by = auth.uid())
        )
    )
  );

-- No update / delete policies — audit log is append-only.
