-- First-time-user product tour state (separate from the onboarding-form wizard
-- tracked by onboarding_status / onboarding in 0053_profile_onboarding.sql).
--
-- tour_status defaults to 'pending' for ALL rows — existing builders and new
-- signups alike — so every current builder sees the guided click-through tour
-- once on their next /b visit. The tour auto-starts only when:
--     tour_status = 'pending' AND onboarding_status <> 'in_progress'
-- (gate lives in app/b/layout.tsx, so it never collides with the form wizard).
-- TutorialProvider flips this to 'completed' on finish or 'dismissed' on
-- close/Esc; the top-bar Help button can replay it regardless of status.

alter table profiles
  add column if not exists tour_status text not null default 'pending'
    check (tour_status in ('pending', 'completed', 'dismissed'));
