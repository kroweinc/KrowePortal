-- ============================================================
-- Board restructure: Inbox → Backlog, new To-Do column, and the
-- Approval column ('blocked' status) removed.
--
-- Approval is no longer a status. It was always tracked by the
-- orthogonal approval_sent_at / approval_approved_at timestamps
-- (0014); tasks awaiting approval now stay in their column and the
-- UI pins them to the top with the approval pill as the indicator.
--
-- This migration:
--   1. renames the status values: inbox → backlog, blocked → in_progress
--      (every blocked task has approval_sent_at backfilled by 0014, so
--      migrated tasks keep their approval indicator)
--   2. swaps the CHECK constraint and default for the new status set
--   3. recreates the operator UPDATE policy (0060) — operators edit
--      backlog tasks, and stamp approval_approved_at on any task
--      awaiting approval regardless of which column it sits in
--   4. recreates the two signing RPCs from 0054 that insert tasks
--      with a literal 'inbox' status
-- ============================================================

begin;

-- 1 + 2. Constraint off → rewrite data → constraint on.
alter table tasks drop constraint tasks_status_check;

update tasks set status = 'backlog'     where status = 'inbox';
update tasks set status = 'in_progress' where status = 'blocked';

alter table tasks add constraint tasks_status_check
  check (status in ('backlog', 'todo', 'in_progress', 'done'));
alter table tasks alter column status set default 'backlog';

-- 3. Operator UPDATE policy. Approval-pending tasks can now sit in any
--    column, so the approve arm keys off approval_sent_at instead of
--    the old 'blocked' status. Approving only sets approval_approved_at
--    (row still satisfies the approval_sent_at arm), so the same
--    expression works for both USING and WITH CHECK.
drop policy if exists "tasks_update_operator" on tasks;
create policy "tasks_update_operator" on tasks
  for update
  using (
    is_engagement_operator(engagement_id)
    and (status = 'backlog' or approval_sent_at is not null)
  )
  with check (
    is_engagement_operator(engagement_id)
    and (status = 'backlog' or approval_sent_at is not null)
  );

-- 4. Signing RPCs (bodies verbatim from 0054, only the inserted task
--    status changes: 'inbox' → 'backlog').
create or replace function sign_and_provision_quote(
  p_token       text,
  p_signer_name text,
  p_signer_ip   text,
  p_operator_id uuid,
  p_milestones  jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_brief        briefs%rowtype;
  v_milestone    jsonb;
  v_milestone_id uuid;
  v_task_title   text;
  v_t_sort       integer;
begin
  select * into v_brief from briefs where token = p_token for update;
  if not found then
    raise exception 'Quote not found';
  end if;
  if v_brief.status <> 'sent' then
    raise exception 'Quote is not awaiting signature (status: %)', v_brief.status;
  end if;

  -- 1. Stamp the signature.
  update briefs
     set status            = 'signed',
         signed_at         = now(),
         signed_by_name    = p_signer_name,
         signer_ip         = p_signer_ip,
         signature_consent = true,
         updated_at        = now()
   where id = v_brief.id;

  -- 2. Attach a signed-in operator to the engagement if it has none yet.
  if p_operator_id is not null then
    update engagements
       set operator_id = p_operator_id
     where id = v_brief.engagement_id
       and operator_id is null;
  end if;

  -- 3 + 4. Milestones and their tasks.
  for v_milestone in
    select * from jsonb_array_elements(coalesce(p_milestones, '[]'::jsonb))
  loop
    insert into milestones (brief_id, engagement_id, title, description, sort_order, source_amount)
    values (
      v_brief.id,
      v_brief.engagement_id,
      coalesce(nullif(v_milestone->>'title', ''), 'Milestone'),
      v_milestone->>'description',
      coalesce((v_milestone->>'sort_order')::integer, 0),
      nullif(v_milestone->>'amount', '')::numeric
    )
    returning id into v_milestone_id;

    v_t_sort := 0;
    for v_task_title in
      select value from jsonb_array_elements_text(coalesce(v_milestone->'tasks', '[]'::jsonb))
    loop
      if length(trim(v_task_title)) > 0 then
        insert into tasks (
          engagement_id, milestone_id, title, source, status,
          created_by, sort_order
        )
        values (
          v_brief.engagement_id,
          v_milestone_id,
          trim(v_task_title),
          'builder_added',
          'backlog',
          v_brief.created_by,
          v_t_sort
        );
        v_t_sort := v_t_sort + 1;
      end if;
    end loop;
  end loop;

  return v_brief.engagement_id;
end;
$$;

create or replace function sign_change_order(
  p_change_order_id uuid,
  p_signer_name     text,
  p_signer_ip       text,
  p_milestone_title text,
  p_tasks           jsonb,
  p_delta_amount    numeric
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_co           change_orders%rowtype;
  v_milestone_id uuid;
  v_task_title   text;
  v_t_sort       integer := 0;
  v_brief_id     uuid;
begin
  select * into v_co from change_orders where id = p_change_order_id for update;
  if not found then
    raise exception 'Change order not found';
  end if;
  if v_co.status <> 'sent' then
    raise exception 'Change order is not awaiting signature (status: %)', v_co.status;
  end if;

  update change_orders
     set status         = 'signed',
         signed_at      = now(),
         signed_by_name = p_signer_name,
         signer_ip      = p_signer_ip,
         delta_amount   = p_delta_amount,
         updated_at     = now()
   where id = v_co.id;

  -- Anchor the milestone to the engagement's signed quote if there is one.
  select id into v_brief_id from briefs
   where engagement_id = v_co.engagement_id and status = 'signed'
   order by signed_at desc limit 1;

  insert into milestones (brief_id, engagement_id, title, description, sort_order, source_amount)
  values (
    v_brief_id,
    v_co.engagement_id,
    coalesce(nullif(p_milestone_title, ''), 'Change order'),
    'Added via signed change order',
    coalesce((select max(sort_order) + 1 from milestones where engagement_id = v_co.engagement_id), 0),
    p_delta_amount
  )
  returning id into v_milestone_id;

  for v_task_title in
    select value from jsonb_array_elements_text(coalesce(p_tasks, '[]'::jsonb))
  loop
    if length(trim(v_task_title)) > 0 then
      insert into tasks (
        engagement_id, milestone_id, title, source, status,
        created_by, sort_order
      )
      values (
        v_co.engagement_id, v_milestone_id, trim(v_task_title),
        'builder_added', 'backlog', v_co.created_by, v_t_sort
      );
      v_t_sort := v_t_sort + 1;
    end if;
  end loop;

  return v_milestone_id;
end;
$$;

commit;
