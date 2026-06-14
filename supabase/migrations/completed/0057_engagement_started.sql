-- ============================================================
-- Engagement "started" marker.
--
-- Previously an engagement was treated as live/started the moment its row
-- existed. But the row is also created as a side effect when an operator
-- accepts ANY outbound doc (PRD/quote) — linkOperatorToProject() spins up a
-- shell so the operator gets portal access. That made the project pipeline
-- jump straight to "Engagement live" on PRD acceptance.
--
-- started_at decouples "the operator is linked" from "the build has begun".
-- It is set only when the builder explicitly begins the engagement, or when
-- a contract is signed (the deal is won). The shell created by doc acceptance
-- leaves it null until then.
-- ============================================================

alter table engagements
  add column if not exists started_at timestamptz;

-- Backfill existing rows so no genuinely-active engagement disappears from the
-- builder's surfaces. Mark started any engagement that is either:
--   * standalone (no project_id) — personal "Shared space" / manually-created;
--   * already has a connected repo;
--   * already has tasks (a real build in progress);
--   * on a project with a signed contract (deal won).
-- Project-linked engagements with none of these are almost certainly the
-- premature PRD/quote shells this change targets — they stay null.
update engagements e
  set started_at = e.created_at
  where e.started_at is null
    and (
      e.project_id is null
      or e.github_repo_full_name is not null
      or exists (select 1 from tasks t where t.engagement_id = e.id)
      or exists (
        select 1 from contracts c
        where c.project_id = e.project_id and c.status = 'signed'
      )
    );
