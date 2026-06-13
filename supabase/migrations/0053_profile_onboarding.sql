-- Builder onboarding wizard state.
--
-- onboarding_status defaults to 'completed' so every existing row (builders,
-- operators created via acceptInvitation's upsert, dev profiles) reads as
-- already-onboarded with zero backfill. Only the wizard's first step ever
-- sets 'in_progress'.
--
-- onboarding jsonb holds wizard-internal state ({ path, step, project_id,
-- engagement_id, completed_at }); nothing outside the wizard queries it.

alter table profiles
  add column if not exists onboarding_status text not null default 'completed'
    check (onboarding_status in ('in_progress', 'completed', 'dismissed')),
  add column if not exists onboarding jsonb not null default '{}'::jsonb;
