-- ============================================================
-- Repo area vocabulary — the product areas a repo is made of
-- ("checkout", "reporting", "granola"), derived once from the
-- repo's tree/README/languages and cached here.
--
-- Replaces the fixed 11-value TASK_TAGS taxonomy (lib/types.ts)
-- as the label set every AI classifier picks from, so a task's
-- area chip names the PRODUCT rather than the shape of the work.
-- TASK_TAGS stays as the fallback vocabulary for repos with no
-- rows here — see resolveAreaVocabulary in lib/tasks/area-vocabulary.ts.
--
-- Keyed on repo_full_name, not engagement: two engagements on one
-- repo share a vocabulary, and repointing an engagement's repo
-- picks up the new repo's rows with nothing to migrate.
--
-- Refreshed by syncRepoAreas() on demand (the Areas card's Refresh
-- button on /b/github) and passively in the background when a row
-- is older than the TTL. Same cache contract as repo_branches (0070).
--
-- Accessed only server-side via the service role.
-- ============================================================

create table repo_areas (
  repo_full_name  text         not null,
  -- What lands in tasks.tags. Kebab-case, ≤24 chars — enforced in
  -- code (normalizeArea) so a bad model slug is repaired, not rejected.
  slug            text         not null,
  -- What the chip shows. Usually a title-cased slug, but the model
  -- may name an area better than its slug reads ("Auth & Billing").
  label           text         not null,
  -- One line describing the area, fed to the classifier as its gloss.
  gloss           text         not null,
  -- Derivation order, so the Areas card and the prompt list agree.
  position        int          not null default 0,
  synced_at       timestamptz  not null default now(),

  primary key (repo_full_name, slug)
);

create index repo_areas_repo_idx
  on repo_areas (repo_full_name);

alter table repo_areas enable row level security;

-- No policies defined for authenticated/anon roles.
-- All access is via service role (bypasses RLS).
