-- ============================================================
-- Agency website — the link the builder pastes on the identity
-- step of onboarding, which the brand fetch reads to fill in
-- their agency name and resolve a real logo.
--
-- Stored as the FINAL url after redirects (https://acme.com), so
-- <BrandLogo> can bare-host it and Settings can link it directly.
-- Nullable, no backfill: it sits beside the other agency identity
-- columns from 0080 and is covered by the same owner-only
-- "builder_profiles_all" RLS policy (0040).
-- ============================================================
alter table builder_profiles
  add column if not exists agency_website text;
