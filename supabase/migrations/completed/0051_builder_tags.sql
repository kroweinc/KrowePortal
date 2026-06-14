-- Achievement / identity badges shown under the builder's name on the public
-- profile, e.g. "Hackathon Winner", "Startup Founder", "7x Years Developing".
-- Stored as a native text[] (mirrors builder_profile_projects.tech) since tags
-- are plain labels with no per-tag metadata — no child table needed.
-- Covered by the existing owner-only RLS policy on builder_profiles.
alter table builder_profiles
  add column if not exists tags text[] not null default '{}';
