-- ============================================================
-- Auto-apply for the "you forgot to mark it done" safeguard (0081).
--
-- 0081 records a commit→task match and waits: the board paints a card and the
-- builder presses Confirm. A near-certain match doesn't need asking — the
-- commit is on main, it plainly finishes the task, and the only thing standing
-- between the task and Done is a click nobody makes. Above the auto threshold
-- the scan now moves the task itself and shows the builder what it did.
--
-- The row stays `state = 'pending'`: it is still awaiting the builder's word,
-- and pending is exactly what the board reads. What changed is that the TASK
-- already moved. `auto_applied_at` is what separates "auto-done, awaiting your
-- word" from "suggested, awaiting your word" — no new state value, no change
-- to the existing check constraint.
--
-- The other two columns exist so rejecting is a true reversal rather than a
-- guess. Marking done is a lossy write (status, completed_at, and possibly an
-- operator's open approval all collapse into one row), so anything the undo
-- needs is recorded here BEFORE the task is touched.
-- ============================================================

alter table commit_task_matches
  add column if not exists auto_applied_at  timestamptz,
  add column if not exists prior_status     text,
  add column if not exists cleared_approval boolean not null default false;

-- Mirrors tasks_status_check. `not valid` is pointless on a fresh nullable
-- column, but the constraint has to reject a bad restore target the same way
-- the tasks table would reject writing it back.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'commit_task_matches_prior_status_check'
  ) then
    alter table commit_task_matches
      add constraint commit_task_matches_prior_status_check
      check (prior_status is null
             or prior_status in ('backlog', 'todo', 'in_progress', 'done'));
  end if;
end $$;

-- An auto-applied row is only reversible while it still holds its snapshot.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'commit_task_matches_auto_snapshot_check'
  ) then
    alter table commit_task_matches
      add constraint commit_task_matches_auto_snapshot_check
      check (auto_applied_at is null or prior_status is not null);
  end if;
end $$;

comment on column commit_task_matches.auto_applied_at is
  'When the scan marked the task done on its own, above the auto-apply '
  'confidence threshold. Null means this row is an ordinary suggestion the '
  'builder still has to confirm. The row stays state=pending either way — the '
  'builder''s Keep/Not done is what resolves it, and on an auto-applied row '
  'Keep is also what releases the held "delivered" notification.';

comment on column commit_task_matches.prior_status is
  'The task''s status immediately before the auto-move, so Not done restores it '
  'instead of dumping everything into backlog. Null on rows that were never '
  'auto-applied.';

comment on column commit_task_matches.cleared_approval is
  'True when the auto-move stamped approval_approved_at on a task that was '
  'still awaiting the operator''s sign-off (0073 resolves the approval gate on '
  'done). Reject un-stamps it only then — a plain prior_approval_approved_at '
  'could not tell "we cleared it" from "it was already approved".';

-- The board reads pending rows by task; the auto-applied ones are also read for
-- tasks that are already done, which the pending-state index alone doesn't
-- narrow. Small partial index over what is by nature a handful of rows.
create index if not exists commit_task_matches_auto_applied_idx
  on commit_task_matches (task_id)
  where state = 'pending' and auto_applied_at is not null;
