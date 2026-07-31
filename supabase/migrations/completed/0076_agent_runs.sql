-- ============================================================
-- Agents Control Center — durable agent runs + messages.
--
-- A builder opens the ⌘K "Ask agent" console, picks a client, and holds a
-- grounded conversation over that client's Context Layer (0059/0060). Each
-- conversation is an `agent_run`; every user / assistant / tool turn is an
-- `agent_message`. Builder-only and engagement-scoped — mirrors the
-- context_items RLS (is_engagement_builder). Runs cascade from the engagement;
-- messages cascade from the run.
-- ============================================================

create table if not exists agent_runs (
  id            uuid        primary key default gen_random_uuid(),
  engagement_id uuid        not null references engagements(id) on delete cascade,
  builder_id    uuid        not null references profiles(id),
  title         text        not null default 'New conversation',
  status        text        not null default 'idle'
                check (status in ('idle','thinking','running_tool','awaiting_input','done','error')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists agent_runs_engagement_idx
  on agent_runs (engagement_id, updated_at desc);

create table if not exists agent_messages (
  id            uuid        primary key default gen_random_uuid(),
  run_id        uuid        not null references agent_runs(id) on delete cascade,
  role          text        not null check (role in ('user','assistant','tool')),
  content       text        not null default '',
  -- assistant rows that propose/emit tool calls carry the raw calls here
  tool_calls    jsonb,
  -- tool-result rows reference the call they answer
  tool_call_id  text,
  -- lifecycle for a proposed write tool: proposed -> confirmed|rejected -> executed|failed
  tool_status   text        check (tool_status in ('proposed','confirmed','rejected','executed','failed')),
  -- retrieved snippets the assistant saw (title/kind/similarity) for the Sources disclosure
  sources       jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists agent_messages_run_idx
  on agent_messages (run_id, created_at);

alter table agent_runs enable row level security;
alter table agent_messages enable row level security;

-- Builder-only, mirroring context_items (0059). agent_runs gate on the
-- engagement directly; agent_messages gate through their run's engagement.
create policy "agent_runs_select" on agent_runs
  for select using (is_engagement_builder(engagement_id));
create policy "agent_runs_insert" on agent_runs
  for insert with check (builder_id = auth.uid() and is_engagement_builder(engagement_id));
create policy "agent_runs_update" on agent_runs
  for update using (is_engagement_builder(engagement_id))
             with check (is_engagement_builder(engagement_id));
create policy "agent_runs_delete" on agent_runs
  for delete using (is_engagement_builder(engagement_id));

create policy "agent_messages_select" on agent_messages
  for select using (exists (
    select 1 from agent_runs r
    where r.id = agent_messages.run_id and is_engagement_builder(r.engagement_id)
  ));
create policy "agent_messages_insert" on agent_messages
  for insert with check (exists (
    select 1 from agent_runs r
    where r.id = agent_messages.run_id and is_engagement_builder(r.engagement_id)
  ));
create policy "agent_messages_update" on agent_messages
  for update using (exists (
    select 1 from agent_runs r
    where r.id = agent_messages.run_id and is_engagement_builder(r.engagement_id)
  )) with check (exists (
    select 1 from agent_runs r
    where r.id = agent_messages.run_id and is_engagement_builder(r.engagement_id)
  ));
create policy "agent_messages_delete" on agent_messages
  for delete using (exists (
    select 1 from agent_runs r
    where r.id = agent_messages.run_id and is_engagement_builder(r.engagement_id)
  ));
