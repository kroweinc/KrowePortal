-- ============================================================
-- Task Build Prompts — AI-generated implementation prompts
-- the operator/builder can copy into a coding agent.
-- One row per (task_id, variant). Regenerate = upsert.
-- ============================================================

create table if not exists task_build_prompts (
  id                uuid primary key default gen_random_uuid(),
  task_id           uuid not null references tasks(id) on delete cascade,
  variant           text not null check (variant in ('claude-code', 'cursor', 'chatgpt')),

  prompt            text not null,
  files_referenced  jsonb not null default '[]'::jsonb,
  notes             text not null default '',
  repo_full_name    text not null,

  generated_by      uuid not null references profiles(id),
  generated_at      timestamptz not null default now(),

  unique (task_id, variant)
);

create index if not exists task_build_prompts_task_id_idx
  on task_build_prompts(task_id);

alter table task_build_prompts enable row level security;

-- SELECT: same visibility rule as task_subtasks / task_commits
create policy "task_build_prompts_select" on task_build_prompts
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

-- INSERT: any engagement member can generate; generated_by must be self
create policy "task_build_prompts_insert" on task_build_prompts
  for insert with check (
    generated_by = auth.uid()
    and exists (
      select 1 from tasks t
      where t.id = task_id
        and (
          (t.engagement_id is not null and is_engagement_member(t.engagement_id))
          or (t.engagement_id is null and t.created_by = auth.uid())
        )
    )
  );

-- UPDATE: required for upsert on regenerate
create policy "task_build_prompts_update" on task_build_prompts
  for update using (
    exists (
      select 1 from tasks t
      where t.id = task_id
        and (
          (t.engagement_id is not null and is_engagement_member(t.engagement_id))
          or (t.engagement_id is null and t.created_by = auth.uid())
        )
    )
  ) with check (
    generated_by = auth.uid()
  );

-- DELETE: same gate as INSERT (cleanup or forced regenerate)
create policy "task_build_prompts_delete" on task_build_prompts
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
