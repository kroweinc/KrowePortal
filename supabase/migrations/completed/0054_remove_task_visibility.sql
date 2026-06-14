-- ============================================================
-- Remove the task "operator visibility" feature.
--
-- Tasks are now visible to every member of an engagement (operator
-- and builder alike). The per-task `operator_visible` flag and all
-- RLS gates that referenced it are removed.
--
-- This migration:
--   1. recreates every SELECT policy that filtered on operator_visible
--      (tasks + the 5 child tables) without the visibility gate
--   2. recreates the two RPCs that inserted operator_visible
--   3. drops the tasks.operator_visible column
--
-- A column cannot be dropped while policies depend on it, so the
-- policies are dropped/recreated first.
-- ============================================================

-- 1. tasks SELECT — member of engagement (or owner of a personal task).
drop policy "tasks_select" on tasks;
create policy "tasks_select" on tasks
  for select using (
    (engagement_id is null and created_by = auth.uid())
    or (engagement_id is not null and is_engagement_member(engagement_id))
  );

-- 1b. child-table SELECT policies — visible whenever the parent task is.
drop policy "task_attachments_select" on task_attachments;
create policy "task_attachments_select" on task_attachments
  for select using (
    exists (
      select 1 from tasks t
      where t.id = task_id
        and (
          (t.engagement_id is not null and is_engagement_member(t.engagement_id))
          or (t.engagement_id is null and t.created_by = auth.uid())
        )
    )
  );

drop policy "task_subtasks_select" on task_subtasks;
create policy "task_subtasks_select" on task_subtasks
  for select using (
    exists (
      select 1 from tasks t
      where t.id = task_id
        and (
          (t.engagement_id is not null and is_engagement_member(t.engagement_id))
          or (t.engagement_id is null and t.created_by = auth.uid())
        )
    )
  );

drop policy "task_audit_log_select" on task_audit_log;
create policy "task_audit_log_select" on task_audit_log
  for select using (
    exists (
      select 1 from tasks t
      where t.id = task_id
        and (
          (t.engagement_id is not null and is_engagement_member(t.engagement_id))
          or (t.engagement_id is null and t.created_by = auth.uid())
        )
    )
  );

drop policy "task_commits_select" on task_commits;
create policy "task_commits_select" on task_commits
  for select using (
    exists (
      select 1 from tasks t
      where t.id = task_id
        and (
          (t.engagement_id is not null and is_engagement_member(t.engagement_id))
          or (t.engagement_id is null and t.created_by = auth.uid())
        )
    )
  );

drop policy "task_build_prompts_select" on task_build_prompts;
create policy "task_build_prompts_select" on task_build_prompts
  for select using (
    exists (
      select 1 from tasks t
      where t.id = task_id
        and (
          (t.engagement_id is not null and is_engagement_member(t.engagement_id))
          or (t.engagement_id is null and t.created_by = auth.uid())
        )
    )
  );

-- 2. RPCs that seeded tasks with operator_visible — recreate without it.
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
          'inbox',
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
        'builder_added', 'inbox', v_co.created_by, v_t_sort
      );
      v_t_sort := v_t_sort + 1;
    end if;
  end loop;

  return v_milestone_id;
end;
$$;

-- 3. Drop the now-unused column.
alter table tasks drop column operator_visible;
