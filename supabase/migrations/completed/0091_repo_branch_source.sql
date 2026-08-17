-- ============================================================
-- Where a cached repo branch came from.
--
-- 'github' — listed by the GitHub API and written by syncRepoBranches. The
--            sweep in that function owns these rows: a branch deleted on the
--            repo disappears from the cache on the next sync.
-- 'local'  — typed by hand in the portal (the branch picker's "Add branch").
--            A builder working solo often never pushes a feature branch, so
--            GitHub has no idea it exists and the chips can't offer it. These
--            rows are the builder's word for a branch, so the GitHub sweep must
--            leave them alone — nothing else will ever re-stamp them.
--
-- When a push finally makes a local branch real, syncRepoBranches reconciles
-- instead of stacking a second chip beside it: an exact name match is adopted in
-- place (the upsert flips source to 'github'), and a near match — the same
-- branch under a different spelling — renames the local row, and every task
-- filed under it, to the name GitHub uses.
--
-- Accessed only server-side via the service role (see 0070).
-- ============================================================

alter table repo_branches
  add column if not exists source text not null default 'github'
  check (source in ('github', 'local'));
