-- ============================================================
-- sign_and_provision_quote — the atomic keystone.
--
-- A single transaction that, when the operator signs a 'sent' quote:
--   1. stamps the signature + flips status to 'signed'
--   2. attaches the operator to the engagement (if a signed-in operator
--      and the engagement has no operator yet)
--   3. inserts the AI-grouped milestones
--   4. spawns a task under each milestone (operator-visible)
--
-- Milestone grouping is an AI call that can't run inside plpgsql, so the
-- caller groups first and passes the result as p_milestones jsonb:
--   [ { "title", "description", "amount", "sort_order", "tasks": ["…"] } ]
--
-- SECURITY DEFINER so it can run from the public (no-account) sign flow.
-- Returns the engagement id.
-- ============================================================

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
          operator_visible, created_by, sort_order
        )
        values (
          v_brief.engagement_id,
          v_milestone_id,
          trim(v_task_title),
          'builder_added',
          'inbox',
          true,
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
