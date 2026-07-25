-- ============================================================
-- Builder Profile — education becomes a list, and every profile
-- item gains a public-visibility toggle.
--
-- 1. builder_profile_education replaces the three education_*
--    columns added in 0049. A builder can hold more than one
--    degree, and the redesigned /b/profile renders them as
--    reorderable cards like projects and experience. Level and
--    month labels are free text validated app-side (same call as
--    coding_tools.category) so the option lists can evolve
--    without a migration.
-- 2. is_hidden lets a builder keep an item on the editor while
--    withholding it from the public share page — the "eye"
--    action on each card. Default false: nothing changes for
--    existing rows.
--
-- The legacy builder_profiles.education_* columns are backfilled
-- and then LEFT IN PLACE. Code stops reading and writing them
-- here; a follow-up migration drops them once the new table has
-- proven itself in production.
-- ============================================================

create table if not exists builder_profile_education (
  id                 uuid primary key default gen_random_uuid(),
  builder_profile_id uuid not null references builder_profiles(id) on delete cascade,
  school             text not null,
  level              text,  -- e.g. 'Bachelor''s', 'Master''s'; validated app-side
  field_of_study     text,
  start_month        text,  -- 'Jan' … 'Dec'
  start_year         text,
  end_month          text,
  end_year           text,  -- blank end = in progress ("or expected")
  is_hidden          boolean not null default false,
  display_order      integer not null default 0,
  created_at         timestamptz not null default now()
);

create index if not exists builder_profile_education_profile_idx
  on builder_profile_education (builder_profile_id, display_order);

-- RLS: owner-only. Public reads go through the admin client + token.
alter table builder_profile_education enable row level security;

drop policy if exists "builder_profile_education_all" on builder_profile_education;
create policy "builder_profile_education_all" on builder_profile_education
  for all using (
    exists (select 1 from builder_profiles bp
            where bp.id = builder_profile_id and bp.user_id = auth.uid())
  )
  with check (
    exists (select 1 from builder_profiles bp
            where bp.id = builder_profile_id and bp.user_id = auth.uid())
  );

-- Backfill the single 0049 entry. education_year was freeform
-- ("Class of 2027", "2020 – 2024") so it lands in end_year, which the
-- app renders verbatim when start_* is absent. Guarded by NOT EXISTS so
-- re-running can't duplicate a builder's row.
insert into builder_profile_education
  (builder_profile_id, school, field_of_study, end_year, display_order)
select bp.id, bp.education_school, nullif(bp.education_major, ''), nullif(bp.education_year, ''), 0
from builder_profiles bp
where coalesce(bp.education_school, '') <> ''
  and not exists (
    select 1 from builder_profile_education e where e.builder_profile_id = bp.id
  );

-- Visibility toggle on the sibling collections.
alter table builder_profile_projects
  add column if not exists is_hidden boolean not null default false;
alter table builder_profile_experience
  add column if not exists is_hidden boolean not null default false;
alter table builder_profile_coding_tools
  add column if not exists is_hidden boolean not null default false;
