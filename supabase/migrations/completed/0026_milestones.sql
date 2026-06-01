-- ============================================================
-- Milestones — the bridge between a signed quote and the work.
--
-- When an operator signs a quote, the portal groups the quote's line
-- items into milestones and spawns tasks under each. Milestones carry
-- their own progress state (derived from child task completion) and
-- ordering, so they are real rows rather than JSONB on the brief.
--
-- tasks.milestone_id links a spawned task back to its milestone.
-- ============================================================

create table milestones (
  id            uuid        primary key default gen_random_uuid(),
  brief_id      uuid        not null references briefs(id) on delete cascade,
  engagement_id uuid        not null references engagements(id) on delete cascade,
  title         text        not null,
  description   text,
  sort_order    integer     not null default 0,
  status        text        not null default 'pending'
                            check (status in ('pending', 'in_progress', 'done')),
  source_amount numeric,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index milestones_brief_idx      on milestones (brief_id, sort_order);
create index milestones_engagement_idx on milestones (engagement_id, sort_order);

alter table milestones enable row level security;

-- Engagement members (builder or operator) can read milestones.
create policy "milestones_select" on milestones
  for select using (is_engagement_member(engagement_id));

-- Only the builder of the engagement can write milestones directly.
-- (Sign-time provisioning runs through a SECURITY DEFINER function.)
create policy "milestones_write" on milestones
  for all using (is_engagement_builder(engagement_id))
  with check (is_engagement_builder(engagement_id));

-- Link tasks to a milestone. ON DELETE SET NULL so deleting a milestone
-- leaves its tasks intact (just ungrouped).
alter table tasks
  add column milestone_id uuid references milestones(id) on delete set null;

create index tasks_milestone_idx on tasks (milestone_id);
