-- ============================================================
-- Projects — builder-owned, OUTBOUND prospective businesses.
--
-- Unlike an engagement (a builder<->operator pairing), a project has
-- exactly one party: the builder who owns it. It is the container a
-- builder uses to prepare client-facing documents (Quote / PRD /
-- Contract) for a business they are pitching, before any operator
-- exists on the platform.
--
-- Documents hang off a project. Access is gated entirely on ownership
-- via is_project_owner(); there is no engagement membership to check.
-- ============================================================

create table projects (
  id             uuid        primary key default gen_random_uuid(),
  owner_id       uuid        not null references profiles(id) on delete cascade,
  name           text        not null,
  status         text        not null default 'active'
                             check (status in ('active', 'won', 'lost', 'archived')),
  prospect_name  text,
  prospect_email text,
  context        text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index projects_owner_idx on projects (owner_id, created_at desc);

alter table projects enable row level security;

-- Analogue of is_engagement_member for the single-party project model.
-- Reused by every project-scoped document policy (briefs, prds, contracts).
create or replace function is_project_owner(pid uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from projects where id = pid and owner_id = auth.uid()
  )
$$;

create policy "projects_select" on projects
  for select using (owner_id = auth.uid());
create policy "projects_insert" on projects
  for insert with check (owner_id = auth.uid());
create policy "projects_update" on projects
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "projects_delete" on projects
  for delete using (owner_id = auth.uid());
