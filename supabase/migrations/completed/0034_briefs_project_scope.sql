-- ============================================================
-- Reparent briefs to projects (outbound quote support).
--
-- A "quote" is just a brief. Outbound quotes hang off a project (no
-- operator); legacy/inbound briefs keep hanging off an engagement.
-- engagement_id becomes nullable and a nullable project_id is added,
-- with a check that exactly one parent is present.
--
-- RLS policies are rewritten to be parent-aware: engagement membership
-- gates engagement briefs, project ownership gates project briefs.
-- Existing engagement briefs are unaffected.
-- ============================================================

alter table briefs add column project_id uuid references projects(id) on delete cascade;
alter table briefs alter column engagement_id drop not null;

-- Exactly one parent — never both, never neither.
alter table briefs add constraint briefs_one_parent_chk
  check (num_nonnulls(engagement_id, project_id) = 1);

create index briefs_project_idx on briefs (project_id, created_at desc);

-- Replace the engagement-only policies (from 0023) with parent-aware ones.
drop policy if exists "briefs_select" on briefs;
drop policy if exists "briefs_insert" on briefs;
drop policy if exists "briefs_update" on briefs;
drop policy if exists "briefs_delete" on briefs;

create policy "briefs_select" on briefs
  for select using (
    (engagement_id is not null and is_engagement_member(engagement_id))
    or (project_id is not null and is_project_owner(project_id))
  );

create policy "briefs_insert" on briefs
  for insert with check (
    created_by = auth.uid()
    and (
      (engagement_id is not null and is_engagement_builder(engagement_id))
      or (project_id is not null and is_project_owner(project_id))
    )
  );

create policy "briefs_update" on briefs
  for update using (
    (engagement_id is not null and is_engagement_member(engagement_id))
    or (project_id is not null and is_project_owner(project_id))
  ) with check (
    (engagement_id is not null and is_engagement_member(engagement_id))
    or (project_id is not null and is_project_owner(project_id))
  );

create policy "briefs_delete" on briefs
  for delete using (
    created_by = auth.uid()
    and (
      (engagement_id is not null and is_engagement_builder(engagement_id))
      or (project_id is not null and is_project_owner(project_id))
    )
  );
