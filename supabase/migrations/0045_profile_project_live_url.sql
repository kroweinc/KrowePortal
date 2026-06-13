-- ============================================================
-- Builder profile projects: live work URL.
--
-- A link to the running deliverable (deployed app / demo) so profile
-- viewers can interact with the work, separate from `url` which for
-- GitHub-sourced rows is overwritten with the repo link on every sync.
-- Builder-set; sync never touches it.
-- ============================================================

alter table builder_profile_projects add column live_url text;
