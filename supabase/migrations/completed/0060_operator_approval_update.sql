-- 0060: Let operators approve tasks the builder sent for approval, without
-- being able to push tasks into in_progress or done.
--
-- The original tasks_update_operator policy (0001_init) restricted operators to
-- rows where status = 'inbox', and — because it had no explicit WITH CHECK —
-- Postgres reused that USING expression as the check on the NEW row too. Result:
-- approveTask, which stamps approval_approved_at on a 'blocked' (Approval) row,
-- was rejected by RLS (old status != 'inbox'). It failed silently (0 rows / RLS
-- error), so the operator "Approve deliverable" action never persisted even
-- though the UI reported success.
--
-- New policy: operators may update tasks on their engagements as long as the row
-- both starts and ends in 'inbox' or 'blocked'. This permits:
--   * editing inbox tasks   (inbox   -> inbox)   e.g. priority
--   * approving a sent task  (blocked -> blocked) approval_approved_at
-- and forbids operator-driven moves into in_progress or done. The UI exposes no
-- operator status-change control — approval is the only operator task action.

begin;

drop policy if exists "tasks_update_operator" on tasks;

create policy "tasks_update_operator" on tasks
  for update
  using (
    is_engagement_operator(engagement_id)
    and status in ('inbox', 'blocked')
  )
  with check (
    is_engagement_operator(engagement_id)
    and status in ('inbox', 'blocked')
  );

commit;
