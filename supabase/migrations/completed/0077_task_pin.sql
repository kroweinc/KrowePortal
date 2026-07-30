-- Pin-to-top: let a task be flagged as the top priority on the board. The
-- operator pins from their /o board; the pin also lifts the task to the top of
-- its column on the builder's /b board (a client-flagged signal).
--
-- A nullable timestamp rather than a boolean, matching the timestamp-as-state
-- idiom already used for approval_sent_at / completed_at: null = not pinned, a
-- timestamp = pinned (and doubles as the tiebreak so the most recently pinned
-- task sits highest). No CHECK / default keeps the SECURITY DEFINER task-insert
-- RPCs untouched, and the existing tasks_update_* RLS policies already cover it
-- (operators update their own engagement's tasks today via approve / request
-- changes), so no new policy is needed.
alter table tasks
  add column if not exists pinned_at timestamptz;

comment on column tasks.pinned_at is
  'When the task was pinned to the top of the board; null = not pinned.';

-- The boards filter pinned tasks per engagement — index the pair.
create index if not exists tasks_engagement_pinned_idx on tasks (engagement_id, pinned_at);
