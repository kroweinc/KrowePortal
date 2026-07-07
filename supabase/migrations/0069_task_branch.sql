-- Staging: tie a done task to the feature branch its work lives on, so the
-- /b/staging release view can group completed work by branch (e.g. every issue
-- on the "lawsuit-intake" branch) and split it into "next push" vs "shipped".
--
-- Freeform text (a GitHub branch name), nullable on purpose: existing done tasks
-- and personal (no-repo) tasks read as "no branch" until one is picked in the
-- done dialog. No CHECK and no default keeps the two SECURITY DEFINER task-insert
-- RPCs (sign_and_provision_quote, sign_change_order) working untouched. Covered
-- by the existing tasks_update_* RLS policies — no new policy needed.
alter table tasks
  add column if not exists branch_name text;

-- The staging view lists a builder's done tasks per engagement, then groups by
-- branch — index the pair it filters/groups on.
create index if not exists tasks_branch_idx on tasks (engagement_id, branch_name);
