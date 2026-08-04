-- ============================================================
-- Onboarding refocus: capture the builder's AGENCY identity and
-- how they CHARGE instead of forcing a project up front.
--
-- All new fields live on builder_profiles (one row per builder) and
-- are nullable, so existing rows and the insert({user_id}) bootstrap
-- need no backfill. Covered by the existing owner-only
-- "builder_profiles_all" RLS policy (0040) — no policy change.
--
-- Keep the check-constraint lists in sync with AGENCY_TYPES,
-- AGENCY_SIZES, and PRICING_MODELS in lib/types.ts. The typical
-- rate captured on the charging step reuses default_hourly_rate
-- (0058) so quotes prefill from it — no new rate column here.
-- ============================================================
alter table builder_profiles
  add column if not exists agency_name   text,
  add column if not exists agency_role   text,
  add column if not exists agency_type   text
    check (agency_type in ('ai', 'web', 'software')),
  add column if not exists agency_size   text
    check (agency_size in ('solo', '2_5', '6_15', '16_plus')),
  add column if not exists pricing_model text
    check (pricing_model in ('hourly', 'fixed_bid', 'retainer'));
