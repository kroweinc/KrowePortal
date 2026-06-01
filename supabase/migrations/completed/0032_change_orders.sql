-- ============================================================
-- Phase 10 — Change-order loop.
--
-- An out-of-scope ask becomes a change order: builder drafts it with
-- line items, sends it, the operator e-signs (reusing the same typed-
-- name + consent signature surface as the quote). On signature, new
-- milestones/tasks are appended to the engagement and the scope-change
-- ledger (running delta_amount total) updates.
--
-- change_orders carries its own token + signature columns, mirroring
-- briefs, so it can reuse the signature mechanics.
-- ============================================================

create table change_orders (
  id             uuid        primary key default gen_random_uuid(),
  engagement_id  uuid        not null references engagements(id) on delete cascade,
  brief_id       uuid        references briefs(id) on delete set null,
  title          text        not null,
  content        jsonb       not null default '{}'::jsonb,
  status         text        not null default 'draft'
                             check (status in ('draft', 'sent', 'signed', 'rejected')),
  token          text        unique default encode(gen_random_bytes(32), 'hex'),
  delta_amount   numeric,
  signed_by_name text,
  signed_at      timestamptz,
  signer_ip      text,
  rejected_at    timestamptz,
  rejection_note text,
  created_by     uuid        not null references profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index change_orders_engagement_idx on change_orders (engagement_id, created_at desc);

alter table change_orders enable row level security;

create policy "change_orders_rw" on change_orders
  for all using (is_engagement_member(engagement_id))
  with check (is_engagement_member(engagement_id));

-- Append a signed change order's line items to the engagement as a new
-- milestone + tasks, in one transaction. Mirrors sign_and_provision_quote.
-- p_tasks is a jsonb array of task title strings.
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
        operator_visible, created_by, sort_order
      )
      values (
        v_co.engagement_id, v_milestone_id, trim(v_task_title),
        'builder_added', 'inbox', true, v_co.created_by, v_t_sort
      );
      v_t_sort := v_t_sort + 1;
    end if;
  end loop;

  return v_milestone_id;
end;
$$;
