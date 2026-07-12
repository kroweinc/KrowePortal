-- 0073: Resolve the approval gate on tasks that were already shipped.
--
-- Approval is tracked by approval_sent_at / approval_approved_at, independent of
-- status. isAwaitingApproval(t) = approval_sent_at && !approval_approved_at and
-- never checked status, so a task sent for approval and then marked Done —
-- before the operator signed off in-app (e.g. the go-ahead happened on a call) —
-- stayed in the operator's "Ready for your review" queue forever.
--
-- markTaskDone (lib/actions/tasks.ts) now stamps approval_approved_at when it
-- ships a still-pending task. This backfills the rows that predate that fix:
-- any done task still awaiting approval is treated as approved-on-completion,
-- using completed_at (falling back to updated_at) as the timestamp.

begin;

update public.tasks
  set approval_approved_at = coalesce(completed_at, updated_at)
  where status = 'done'
    and approval_sent_at is not null
    and approval_approved_at is null;

commit;
