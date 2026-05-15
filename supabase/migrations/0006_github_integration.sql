-- Already applied manually in Supabase. This file documents the schema for fresh-DB resets.

-- Stores the GitHub OAuth token per user (one per builder)
create table if not exists github_connections (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  access_token    text not null,
  github_username text not null,
  github_user_id  bigint not null,
  connected_at    timestamptz not null default now(),
  unique(user_id)
);

-- Add repo fields to engagements (one repo per engagement)
alter table engagements
  add column if not exists github_repo_full_name  text,
  add column if not exists github_repo_id         bigint,
  add column if not exists github_repo_name       text,
  add column if not exists github_repo_owner      text,
  add column if not exists github_default_branch  text;

-- RLS for github_connections
alter table github_connections enable row level security;

create policy "github_connections_select" on github_connections
  for select using (auth.uid() = user_id);

create policy "github_connections_insert" on github_connections
  for insert with check (auth.uid() = user_id);

create policy "github_connections_update" on github_connections
  for update using (auth.uid() = user_id);

create policy "github_connections_delete" on github_connections
  for delete using (auth.uid() = user_id);
