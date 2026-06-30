-- Linear-style task classification: a single change type plus AI-generated
-- area labels. `type` is nullable on purpose — existing tasks read as "untyped"
-- until the AI classifier (lib/actions/classify-task.ts) or a manual edit sets
-- one, so we never mislabel history. New tasks get auto-classified on creation
-- (alongside the hours estimate) in createTask.
alter table tasks
  add column type text
  check (type in ('feature', 'bug', 'change'));

-- AI-assigned area label from a fixed taxonomy (TASK_TAGS in lib/types.ts) —
-- a task gets exactly one (e.g. 'auth', 'ui'). Kept as text[] (a single-element
-- array) so adding more labels later needs no schema change; defaults to empty
-- so reads never see null. Display-only for now.
alter table tasks
  add column tags text[] not null default '{}';
