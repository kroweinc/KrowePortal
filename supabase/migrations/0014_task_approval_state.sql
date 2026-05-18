alter table public.tasks
  add column approval_sent_at timestamptz,
  add column approval_approved_at timestamptz;

-- Backfill pre-existing blocked tasks so their pill renders after deploy
update public.tasks
  set approval_sent_at = updated_at
  where status = 'blocked' and approval_sent_at is null;
