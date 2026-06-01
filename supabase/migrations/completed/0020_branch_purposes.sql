-- ============================================================
-- Branch purposes — AI-generated 1-sentence purpose per git branch.
-- Keyed by (repo_full_name, branch_name, tip_sha) so a branch's
-- purpose is recomputed only when its tip changes.
--
-- Accessed only server-side via the service role.
-- ============================================================

create table branch_purposes (
  repo_full_name  text         not null,
  branch_name     text         not null,
  tip_sha         text         not null,

  purpose         text         not null,
  model           text         not null,
  generated_at    timestamptz  not null default now(),

  primary key (repo_full_name, branch_name, tip_sha)
);

create index branch_purposes_repo_idx
  on branch_purposes (repo_full_name, generated_at desc);

alter table branch_purposes enable row level security;

-- No policies defined for authenticated/anon roles.
-- All access is via service role (bypasses RLS).
