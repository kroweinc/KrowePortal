-- ============================================================
-- Krowe Portal — Initial Schema
-- ============================================================

-- profiles: one row per auth user
create table if not exists profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  role          text not null check (role in ('operator', 'builder')),
  display_name  text,
  created_at    timestamptz not null default now()
);

-- engagements: pairing between one operator and one builder
create table if not exists engagements (
  id           uuid primary key default gen_random_uuid(),
  operator_id  uuid not null references profiles(id) on delete cascade,
  builder_id   uuid not null references profiles(id) on delete cascade,
  title        text not null,
  created_at   timestamptz not null default now()
);

-- tasks: the core work item
create table if not exists tasks (
  id                       uuid primary key default gen_random_uuid(),
  engagement_id            uuid not null references engagements(id) on delete cascade,
  title                    text not null,
  description              text,
  source                   text not null check (source in ('operator_request', 'builder_added')),
  status                   text not null default 'inbox' check (status in ('inbox', 'in_progress', 'blocked', 'done')),
  operator_visible         boolean not null default true,
  builder_estimate_hours   numeric check (builder_estimate_hours >= 0),
  created_by               uuid not null references profiles(id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- ============================================================
-- Row-Level Security
-- ============================================================

alter table profiles enable row level security;
alter table engagements enable row level security;
alter table tasks enable row level security;

-- profiles: users can read their own profile; write their own
create policy "profiles_select" on profiles
  for select using (auth.uid() = id);

create policy "profiles_insert" on profiles
  for insert with check (auth.uid() = id);

create policy "profiles_update" on profiles
  for update using (auth.uid() = id);

-- engagements: visible to the operator or builder on it
create policy "engagements_select" on engagements
  for select using (
    auth.uid() = operator_id or auth.uid() = builder_id
  );

-- tasks: helper to check engagement membership
create or replace function is_engagement_member(eid uuid)
returns boolean
language sql
security definer
as $$
  select exists (
    select 1 from engagements
    where id = eid
      and (operator_id = auth.uid() or builder_id = auth.uid())
  )
$$;

create or replace function is_engagement_builder(eid uuid)
returns boolean
language sql
security definer
as $$
  select exists (
    select 1 from engagements
    where id = eid and builder_id = auth.uid()
  )
$$;

create or replace function is_engagement_operator(eid uuid)
returns boolean
language sql
security definer
as $$
  select exists (
    select 1 from engagements
    where id = eid and operator_id = auth.uid()
  )
$$;

-- tasks select: member of engagement AND (builder OR task is operator-visible)
create policy "tasks_select" on tasks
  for select using (
    is_engagement_member(engagement_id)
    and (
      operator_visible = true
      or is_engagement_builder(engagement_id)
    )
  );

-- tasks insert: operator can only add operator_request; builder can only add builder_added
create policy "tasks_insert_operator" on tasks
  for insert with check (
    is_engagement_operator(engagement_id)
    and source = 'operator_request'
    and created_by = auth.uid()
  );

create policy "tasks_insert_builder" on tasks
  for insert with check (
    is_engagement_builder(engagement_id)
    and source = 'builder_added'
    and created_by = auth.uid()
  );

-- tasks update: builder can update anything on their engagements
create policy "tasks_update_builder" on tasks
  for update using (is_engagement_builder(engagement_id));

-- tasks update: operator can update title/description only while status='inbox'
-- (enforced at app layer for simplicity; RLS allows the row access)
create policy "tasks_update_operator" on tasks
  for update using (
    is_engagement_operator(engagement_id)
    and status = 'inbox'
  );
