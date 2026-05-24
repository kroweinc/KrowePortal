-- ============================================================
-- Task estimate range — store lowest/highest possible hours
-- alongside the existing midpoint (builder_estimate_hours).
-- ============================================================

alter table tasks
  add column builder_estimate_low_hours  numeric(6,2) check (builder_estimate_low_hours  is null or builder_estimate_low_hours  >= 0),
  add column builder_estimate_high_hours numeric(6,2) check (builder_estimate_high_hours is null or builder_estimate_high_hours >= 0),
  add constraint tasks_estimate_range_chk
    check (
      builder_estimate_high_hours is null
      or builder_estimate_low_hours  is null
      or builder_estimate_high_hours >= builder_estimate_low_hours
    );
