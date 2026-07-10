-- ============================================================
-- Branch push marks — the last merge we auto-shipped per branch.
--
-- When a feature branch (e.g. "dev") is merged into the repo's
-- default branch, the staging board's PR-merge poll flips that
-- branch's done tasks from "Next push" to "Shipped" (pushed_to_main).
-- This table records the merge commit sha we acted on so the poll is:
--   * idempotent — re-running on staging load doesn't re-toast or
--     re-ship the same merge, and
--   * undo-safe — if the builder undoes an auto-move, the recorded
--     sha is unchanged so the next poll won't re-ship it.
-- A new merge into the default branch produces a new sha, which is
-- what triggers the next batch to ship.
--
-- Accessed only server-side via the service role.
-- ============================================================

create table branch_push_marks (
  repo_full_name  text         not null,
  branch_name     text         not null,
  merge_sha       text         not null,
  updated_at      timestamptz  not null default now(),

  primary key (repo_full_name, branch_name)
);

alter table branch_push_marks enable row level security;

-- No policies defined for authenticated/anon roles.
-- All access is via service role (bypasses RLS).
