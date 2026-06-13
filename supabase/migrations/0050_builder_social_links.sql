-- GitHub and portfolio links on the builder profile, sitting alongside
-- linkedin_url as basics. github_url is a freeform profile/page link (distinct
-- from the github_connections OAuth used to sync verified repo stats);
-- portfolio_url is any external site the builder wants to show clients.
-- Covered by the existing owner-only RLS policy on builder_profiles.
alter table builder_profiles
  add column if not exists github_url    text,
  add column if not exists portfolio_url text;
