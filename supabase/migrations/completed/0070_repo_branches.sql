-- ============================================================
-- Repo branch cache — the live branch list for a GitHub repo,
-- persisted so the done dialog and the /b staging views can paint
-- the branch chips instantly (no GitHub round-trip on open) and
-- keep working while the API is rate-limited.
--
-- Refreshed from the GitHub API by syncRepoBranches() on demand
-- (the picker's Refresh button) and passively when a row is older
-- than the branch-graph TTL, so it tracks the repo as branches are
-- pushed/deleted.
--
-- Accessed only server-side via the service role.
-- ============================================================

create table repo_branches (
  repo_full_name  text         not null,
  branch_name     text         not null,
  is_default      boolean      not null default false,
  synced_at       timestamptz  not null default now(),

  primary key (repo_full_name, branch_name)
);

create index repo_branches_repo_idx
  on repo_branches (repo_full_name);

alter table repo_branches enable row level security;

-- No policies defined for authenticated/anon roles.
-- All access is via service role (bypasses RLS).
