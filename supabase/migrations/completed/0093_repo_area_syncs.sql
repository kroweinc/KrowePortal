-- ============================================================
-- Repo area derivation ledger — one row per repo we have TRIED
-- to name areas for, whether or not the attempt produced any.
--
-- repo_areas (0092) records the result; it cannot record a null
-- result. Without this table a repo whose derivation comes back
-- empty — a small or layer-organized repo where fewer than three
-- areas survive the framework-slug filter — has no rows, so the
-- background warm on every /b page load reads it as "never
-- derived" and pays another GitHub crawl plus another model call,
-- forever, against no budget gate.
--
-- Also the reason the warm no longer resamples on a TTL. Unlike
-- repo_branches, whose upstream is GitHub's actual branch list,
-- this cache's upstream is a model: an unattended resample can
-- legitimately return "reports" where it once said "reporting",
-- and the sweep that follows would orphan every task already
-- filed under the old slug. Re-derivation is therefore explicit
-- (the Refresh button), and this table is what makes "already
-- attempted" durable.
--
-- Accessed only server-side via the service role.
-- ============================================================

create table repo_area_syncs (
  repo_full_name  text         not null primary key,
  -- 'ok' = areas were derived and written to repo_areas.
  -- 'empty' = the model or the guard produced nothing usable.
  -- 'failed' = the derivation errored (no repo, API failure, unparseable).
  outcome         text         not null,
  -- How many areas the attempt yielded; 0 for 'empty' and 'failed'.
  area_count      int          not null default 0,
  attempted_at    timestamptz  not null default now(),

  constraint repo_area_syncs_outcome_check
    check (outcome in ('ok', 'empty', 'failed'))
);

alter table repo_area_syncs enable row level security;

-- No policies defined for authenticated/anon roles.
-- All access is via service role (bypasses RLS).
