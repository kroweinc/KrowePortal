-- 0072: Let operators send a task awaiting approval back to In Progress.
--
-- requestTaskChanges (lib/actions/tasks.ts) is the operator "Request changes"
-- action: on a task the builder sent for approval it clears approval_sent_at
-- and sets status = 'in_progress' so the builder picks it back up.
--
-- The operator UPDATE policy (last set in 0065, itself descended from 0060)
-- had a WITH CHECK of:
--     is_engagement_operator(engagement_id)
--     and (status = 'backlog' or approval_sent_at is not null)
-- The send-back's NEW row is status='in_progress' with approval_sent_at=null,
-- which satisfies neither arm, so Postgres rejected it with
-- "new row violates row-level security policy for table tasks". Real operators
-- (anon/RLS client) hit this; dev operators didn't, because DEV_PROFILE_IDS use
-- the service-role client that bypasses RLS — hence "works in dev, fails in prod".
--
-- Fix: allow 'in_progress' as a valid resulting state in WITH CHECK. The USING
-- clause is unchanged, so operators may still only touch backlog or
-- awaiting-approval rows on their own engagements; this only widens what those
-- rows may become. 0060's core restriction still holds — operators cannot move
-- a task to 'todo' or 'done'.

begin;

drop policy if exists "tasks_update_operator" on tasks;

create policy "tasks_update_operator" on tasks
  for update
  using (
    is_engagement_operator(engagement_id)
    and (status = 'backlog' or approval_sent_at is not null)
  )
  with check (
    is_engagement_operator(engagement_id)
    and (status in ('backlog', 'in_progress') or approval_sent_at is not null)
  );

commit;
