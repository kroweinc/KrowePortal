-- ============================================================
-- Optional display-name override for builder profiles.
--
-- The public profile page shows profiles.display_name (the account
-- name) by default. This column lets builders override what clients
-- see on the share link without touching their account identity.
-- NULL/empty means "use the account name".
-- ============================================================

alter table builder_profiles
  add column if not exists display_name text;
