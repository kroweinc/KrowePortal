-- ============================================================
-- Cached AI-generated project profiles, keyed by repo + commit.
-- One row per (repo_full_name, commit_sha) so we keep history
-- of how the profile evolves across commits.
--
-- Accessed only server-side via the service role (no RLS policies
-- needed for the public role; we enable RLS to be safe).
-- ============================================================

create table project_profiles (
  repo_full_name   text         not null,
  commit_sha       text         not null,

  summary          text         not null,
  audience         text         not null,
  features         jsonb        not null default '[]'::jsonb,
  current_state    text         not null
                                  check (current_state in ('early', 'active', 'mature', 'dormant')),
  state_rationale  text         not null,
  services         jsonb        not null default '[]'::jsonb,

  model            text         not null,
  tool_rounds      integer,
  tool_calls       integer,
  files_read       integer,
  total_bytes      bigint,
  hit_max_rounds   boolean,
  degraded         jsonb,

  generated_at     timestamptz  not null default now(),

  primary key (repo_full_name, commit_sha)
);

-- Lookup the latest profile for a repo across commits when needed.
create index project_profiles_repo_idx
  on project_profiles (repo_full_name, generated_at desc);

alter table project_profiles enable row level security;

-- No policies defined for authenticated/anon roles.
-- All access is via service role (bypasses RLS).
