-- ============================================================
-- Commit summaries — AI-translated plain-English summary per
-- commit, written for non-technical operators reading the
-- recent activity feed on their project page.
--
-- Keyed by (repo_full_name, commit_sha). Commit SHAs are
-- content-addressed, so a row never needs to be invalidated.
--
-- Accessed only server-side via the service role.
-- ============================================================

create table commit_summaries (
  repo_full_name  text         not null,
  commit_sha      text         not null,

  summary         text         not null,
  category        text         not null
                                  check (category in ('feature', 'fix', 'cleanup', 'docs', 'infra', 'other')),

  model           text         not null,
  generated_at    timestamptz  not null default now(),

  primary key (repo_full_name, commit_sha)
);

create index commit_summaries_repo_idx
  on commit_summaries (repo_full_name, generated_at desc);

alter table commit_summaries enable row level security;

-- No policies defined for authenticated/anon roles.
-- All access is via service role (bypasses RLS).
