-- ============================================================
-- Agent runs become polymorphic: chat runs (0076) + PRD generation runs.
--
-- PRD generation used to be a request-scoped SSE stream owned by the wizard
-- (app/api/ai/prd/stream) — navigate away and the fetch aborts and the work is
-- discarded. We now run the final generation as a durable agent_run so it shows
-- in the same topbar queue, survives navigation/refresh via after(), and lands a
-- finished PRD. A PRD is PROJECT-scoped (is_project_owner), and often has no
-- engagement yet (engagements.project_id is linked lazily, 0039) — so this run
-- hangs off project_id, and engagement_id becomes nullable.
--
-- kind defaults to 'chat', so every existing row backfills unchanged and the
-- engagement-scoped policies keep behaving identically for chat runs.
-- ============================================================

alter table agent_runs
  add column if not exists kind text not null default 'chat'
    check (kind in ('chat','prd'));

-- The PRD this run is (or will be) drafting. Set when generation completes.
alter table agent_runs
  add column if not exists project_id uuid references projects(id) on delete cascade;
alter table agent_runs
  add column if not exists prd_id uuid references prds(id) on delete set null;

-- The DraftPrdInput the run generates from (title/notes/answers/round). Persisted
-- so the run is self-contained — the route generates from the row, and a
-- dock-triggered retry needs no wizard round trip.
alter table agent_runs
  add column if not exists prd_input jsonb;

-- A PRD run has no engagement; a chat run has no project. Relax the NOT NULL and
-- enforce "exactly the right scope for the kind" instead.
alter table agent_runs alter column engagement_id drop not null;
alter table agent_runs
  add constraint agent_runs_scope_ck check (
    (kind = 'chat' and engagement_id is not null) or
    (kind = 'prd'  and project_id  is not null)
  );

create index if not exists agent_runs_project_idx
  on agent_runs (project_id, updated_at desc);

-- RLS: grant by EITHER the engagement (chat) OR the project owner (prd). The
-- security-definer helpers return false for a null id, so each branch only
-- matches its own kind. Replaces the four engagement-only agent_runs policies
-- and the four run-scoped agent_messages policies from 0076.
drop policy if exists "agent_runs_select" on agent_runs;
drop policy if exists "agent_runs_insert" on agent_runs;
drop policy if exists "agent_runs_update" on agent_runs;
drop policy if exists "agent_runs_delete" on agent_runs;

create policy "agent_runs_select" on agent_runs
  for select using (
    is_engagement_builder(engagement_id) or is_project_owner(project_id)
  );
create policy "agent_runs_insert" on agent_runs
  for insert with check (
    builder_id = auth.uid()
    and (is_engagement_builder(engagement_id) or is_project_owner(project_id))
  );
create policy "agent_runs_update" on agent_runs
  for update using (
    is_engagement_builder(engagement_id) or is_project_owner(project_id)
  ) with check (
    is_engagement_builder(engagement_id) or is_project_owner(project_id)
  );
create policy "agent_runs_delete" on agent_runs
  for delete using (
    is_engagement_builder(engagement_id) or is_project_owner(project_id)
  );

drop policy if exists "agent_messages_select" on agent_messages;
drop policy if exists "agent_messages_insert" on agent_messages;
drop policy if exists "agent_messages_update" on agent_messages;
drop policy if exists "agent_messages_delete" on agent_messages;

create policy "agent_messages_select" on agent_messages
  for select using (exists (
    select 1 from agent_runs r
    where r.id = agent_messages.run_id
      and (is_engagement_builder(r.engagement_id) or is_project_owner(r.project_id))
  ));
create policy "agent_messages_insert" on agent_messages
  for insert with check (exists (
    select 1 from agent_runs r
    where r.id = agent_messages.run_id
      and (is_engagement_builder(r.engagement_id) or is_project_owner(r.project_id))
  ));
create policy "agent_messages_update" on agent_messages
  for update using (exists (
    select 1 from agent_runs r
    where r.id = agent_messages.run_id
      and (is_engagement_builder(r.engagement_id) or is_project_owner(r.project_id))
  )) with check (exists (
    select 1 from agent_runs r
    where r.id = agent_messages.run_id
      and (is_engagement_builder(r.engagement_id) or is_project_owner(r.project_id))
  ));
create policy "agent_messages_delete" on agent_messages
  for delete using (exists (
    select 1 from agent_runs r
    where r.id = agent_messages.run_id
      and (is_engagement_builder(r.engagement_id) or is_project_owner(r.project_id))
  ));
