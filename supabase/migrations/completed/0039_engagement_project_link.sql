-- 0039: Link engagements to the outbound project they were started from, and
-- let milestones be seeded from an outbound quote (quotes table) instead of
-- only an inbound brief.

-- ON DELETE SET NULL: deleting a project must never destroy a live engagement
-- and its tasks.
alter table engagements
  add column if not exists project_id uuid references projects(id) on delete set null;

create index if not exists engagements_project_idx on engagements (project_id);

-- One engagement per project — backs the idempotency guard in beginEngagement()
-- against double-clicks/races.
create unique index if not exists engagements_project_unique
  on engagements (project_id) where project_id is not null;

-- Milestones were inbound-only (brief_id not null). Outbound seeding ties a
-- milestone to the signed quote it came from instead.
alter table milestones alter column brief_id drop not null;

alter table milestones
  add column if not exists quote_id uuid references quotes(id) on delete set null;

create index if not exists milestones_quote_idx on milestones (quote_id);
