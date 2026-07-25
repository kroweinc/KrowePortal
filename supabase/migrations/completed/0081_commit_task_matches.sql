-- ============================================================
-- Commit → task matches — the "you forgot to mark this done" safeguard.
--
-- Builders finish work, push it to the default branch, and leave the
-- task sitting in In Progress. On board load we scan new commits on
-- that branch and ask the model whether any of them plainly finish an
-- open task. A high-confidence match strikes the task through on the
-- Build Board with a Confirm / Not done prompt — it NEVER marks the
-- task done on its own.
--
-- Keyed by (repo_full_name, commit_sha) like commit_summaries (0022):
-- commit SHAs are content-addressed, so a row never needs invalidating.
--
-- One table, two jobs. A row with task_id IS NULL means "we scanned
-- this commit and it matched nothing" — that memo is the whole reason
-- the scan is cheap, because it stops us re-running the model over the
-- same commits on every single board load. Steady state is zero AI calls.
--
-- Accessed only server-side via the service role. Every read and write
-- goes through a server action that runs its own isTaskMember /
-- getEngagementRepoById authorization check first.
-- ============================================================

create table commit_task_matches (
  repo_full_name      text         not null,
  commit_sha          text         not null,

  -- Null = scanned, no match (see the memo note above). Cascade on task
  -- delete so a removed task can't leave a suggestion pointing at nothing.
  task_id             uuid         references tasks(id) on delete cascade,
  confidence          real,
  reason              text,

  -- Snapshot of the commit as GitHub reported it, so confirming can write
  -- the task_commits link (and the done branch) with no second API call.
  commit_url          text,
  commit_message      text,
  commit_author_name  text,
  commit_author_login text,
  commit_committed_at timestamptz,
  -- The branch we scanned — always the repo's default branch, which is why
  -- confirming can safely set pushed_to_main.
  branch_name         text,

  state               text         not null default 'pending'
                                     check (state in ('pending', 'confirmed', 'dismissed')),
  resolved_by         uuid         references profiles(id),
  resolved_at         timestamptz,

  model               text,
  generated_at        timestamptz  not null default now(),

  primary key (repo_full_name, commit_sha)
);

-- The board read is "give me every unresolved match for these task ids".
create index commit_task_matches_task_idx
  on commit_task_matches (task_id)
  where task_id is not null and state = 'pending';

alter table commit_task_matches enable row level security;

-- No policies defined for authenticated/anon roles.
-- All access is via service role (bypasses RLS), same as commit_summaries,
-- repo_branches, and branch_push_marks.
