-- ============================================================
-- Board sort preference — the Build Board's sort follows the user, not the browser.
--
-- The sort dropdown persisted only to localStorage, so the choice was scoped to
-- one browser on one machine at one origin: a different browser, a new laptop,
-- or localhost vs. the deployed portal each started back at Priority. It's a
-- personal view preference, not shared state, so it belongs on the profile row
-- rather than in a table of its own.
--
-- NULL means "never chosen" — TaskSortProvider then falls back to the browser's
-- localStorage value (the pre-0090 store) and writes it back here on that first
-- load, so nobody's existing choice is lost on the way over.
--
-- No new RLS: profiles_select / profiles_update (0001) are already scoped to the
-- row's own user, which is exactly who may read or set this.
--
-- Keep the allowed values in sync with TaskSortKey in lib/utils.ts.
-- ============================================================

alter table public.profiles
  add column if not exists board_sort text
    check (board_sort in ('default', 'updated', 'completed', 'name', 'created'));

comment on column public.profiles.board_sort is
  'Build Board sort key: default | updated | completed | name | created. NULL = never chosen (falls back to the browser''s localStorage value).';
