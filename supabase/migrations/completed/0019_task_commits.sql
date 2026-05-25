-- ============================================================
-- Task Commits — link one or more git commits to a completed task
-- ============================================================

create table if not exists task_commits (
  id                    uuid primary key default gen_random_uuid(),
  task_id               uuid not null references tasks(id) on delete cascade,
  repo_full_name        text not null,
  commit_sha            text not null check (char_length(commit_sha) between 7 and 64),
  commit_url            text not null,
  commit_message        text,
  commit_author_name    text,
  commit_author_login   text,
  commit_committed_at   timestamptz,
  linked_by             uuid not null references profiles(id),
  linked_at             timestamptz not null default now(),
  unique (task_id, repo_full_name, commit_sha)
);

create index if not exists task_commits_task_id_idx on task_commits(task_id);

alter table task_commits enable row level security;

-- SELECT: same visibility rule as task_subtasks / task_audit_log
create policy "task_commits_select" on task_commits
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

-- INSERT: only the builder on the engagement; linked_by must be self
create policy "task_commits_insert" on task_commits
  for insert with check (
    linked_by = auth.uid()
    and exists (
      select 1 from tasks t
      where t.id = task_id
        and (
          (t.engagement_id is not null and is_engagement_builder(t.engagement_id))
          or (t.engagement_id is null and t.created_by = auth.uid())
        )
    )
  );

-- DELETE: same gate as INSERT (so a mis-link can be undone)
create policy "task_commits_delete" on task_commits
  for delete using (
    exists (
      select 1 from tasks t
      where t.id = task_id
        and (
          (t.engagement_id is not null and is_engagement_builder(t.engagement_id))
          or (t.engagement_id is null and t.created_by = auth.uid())
        )
    )
  );

-- No update policy — links are immutable; to change, delete and re-insert.
