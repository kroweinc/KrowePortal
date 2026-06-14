-- Builder pricing defaults that seed the BASE of every new quote: the blended
-- hourly rate line items price at, the payment-terms preset, and how the design
-- system is handled (bundled / a fixed charge / not included). They live on
-- builder_profiles (one row per builder) and are covered by the existing
-- owner-only "builder_profiles_all" RLS policy (0040) — no policy change needed.
--
-- Keep the check-constraint lists below in sync with PAYMENT_TERMS_PRESETS and
-- DESIGN_SYSTEM_MODES in lib/types.ts. The not-null defaults match the prior
-- hardcoded behavior (rate 45, 50/25/25, design bundled) so existing rows and
-- the insert({user_id}) bootstrap need no backfill.
alter table builder_profiles
  add column if not exists default_hourly_rate integer not null default 45
    check (default_hourly_rate >= 0 and default_hourly_rate <= 100000),
  add column if not exists payment_terms_preset text not null default '50_25_25'
    check (payment_terms_preset in ('50_25_25', '50_50', '100_upfront', '34_33_33')),
  add column if not exists design_system_mode text not null default 'included'
    check (design_system_mode in ('included', 'fixed', 'none')),
  add column if not exists design_fixed_cost integer not null default 0
    check (design_fixed_cost >= 0 and design_fixed_cost <= 1000000);
