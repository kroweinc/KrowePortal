-- ============================================================
-- Briefs — builder-authored project quote / SOW that the operator
-- reviews and accepts (or rejects) before any work begins.
--
-- A brief belongs to one engagement. The builder drafts it,
-- "sends" it, and the operator transitions it to accepted or
-- rejected. Status transitions are enforced server-side; RLS only
-- gates row access to engagement members.
--
-- content is JSONB so the structure can evolve per project — the
-- builder controls which sections, line items, and totals are
-- included on a per-brief basis.
-- ============================================================

create table briefs (
  id              uuid         primary key default gen_random_uuid(),
  engagement_id   uuid         not null references engagements(id) on delete cascade,
  created_by      uuid         not null references profiles(id),
  title           text         not null,
  status          text         not null default 'draft'
                                check (status in ('draft', 'sent', 'accepted', 'rejected')),
  content         jsonb        not null default '{}'::jsonb,
  sent_at         timestamptz,
  accepted_at     timestamptz,
  accepted_by     uuid         references profiles(id),
  rejected_at     timestamptz,
  rejection_note  text,
  created_at      timestamptz  not null default now(),
  updated_at      timestamptz  not null default now()
);

create index briefs_engagement_idx on briefs (engagement_id, created_at desc);
create index briefs_status_idx     on briefs (engagement_id, status);

alter table briefs enable row level security;

-- Members of the engagement (builder or operator) can read briefs.
create policy "briefs_select" on briefs
  for select using (
    exists (
      select 1 from engagements e
      where e.id = briefs.engagement_id
        and (e.builder_id = auth.uid() or e.operator_id = auth.uid())
    )
  );

-- Only the builder of the engagement can insert briefs.
-- created_by is enforced to match the caller.
create policy "briefs_insert" on briefs
  for insert with check (
    created_by = auth.uid()
    and exists (
      select 1 from engagements e
      where e.id = briefs.engagement_id and e.builder_id = auth.uid()
    )
  );

-- Engagement members can update briefs. Business-rule transitions
-- (draft -> sent by builder; sent -> accepted/rejected by operator)
-- are enforced in the server action, mirroring task approval.
create policy "briefs_update" on briefs
  for update using (
    exists (
      select 1 from engagements e
      where e.id = briefs.engagement_id
        and (e.builder_id = auth.uid() or e.operator_id = auth.uid())
    )
  ) with check (
    exists (
      select 1 from engagements e
      where e.id = briefs.engagement_id
        and (e.builder_id = auth.uid() or e.operator_id = auth.uid())
    )
  );

-- Only the builder who created it can delete it (and only drafts in practice — enforced server-side).
create policy "briefs_delete" on briefs
  for delete using (
    created_by = auth.uid()
    and exists (
      select 1 from engagements e
      where e.id = briefs.engagement_id and e.builder_id = auth.uid()
    )
  );
