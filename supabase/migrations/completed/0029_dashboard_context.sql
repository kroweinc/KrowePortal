-- ============================================================
-- Phase 7 — Context & Collaboration surfaces on the engagement.
--   builder_availability   : is the builder on it right now (builder-owned)
--   deliverables           : thread of shipped artifacts
--   context_materials      : operator-uploaded reference materials
--   business_context_cards : "the old workflow" + "the problem" narratives
--
-- RLS mirrors briefs: any engagement member can read/write; the
-- server actions enforce role-specific rules (who may edit what).
-- ============================================================

create table builder_availability (
  engagement_id uuid        primary key references engagements(id) on delete cascade,
  status        text        not null default 'available'
                            check (status in ('available', 'limited', 'away')),
  weekly_hours  integer,
  note          text,
  updated_at    timestamptz not null default now()
);

create table deliverables (
  id            uuid        primary key default gen_random_uuid(),
  engagement_id uuid        not null references engagements(id) on delete cascade,
  milestone_id  uuid        references milestones(id) on delete set null,
  author_id     uuid        not null references profiles(id),
  title         text        not null,
  body          text,
  url           text,
  created_at    timestamptz not null default now()
);
create index deliverables_engagement_idx on deliverables (engagement_id, created_at desc);

create table context_materials (
  id            uuid        primary key default gen_random_uuid(),
  engagement_id uuid        not null references engagements(id) on delete cascade,
  kind          text        not null default 'link' check (kind in ('link', 'note')),
  title         text        not null,
  url           text,
  body          text,
  category      text,
  uploaded_by   uuid        not null references profiles(id),
  created_at    timestamptz not null default now()
);
create index context_materials_engagement_idx on context_materials (engagement_id, created_at desc);

create table business_context_cards (
  engagement_id uuid        not null references engagements(id) on delete cascade,
  kind          text        not null check (kind in ('old_workflow', 'problem')),
  body          text        not null default '',
  updated_at    timestamptz not null default now(),
  primary key (engagement_id, kind)
);

alter table builder_availability   enable row level security;
alter table deliverables            enable row level security;
alter table context_materials       enable row level security;
alter table business_context_cards  enable row level security;

create policy "builder_availability_rw" on builder_availability
  for all using (is_engagement_member(engagement_id))
  with check (is_engagement_member(engagement_id));

create policy "deliverables_rw" on deliverables
  for all using (is_engagement_member(engagement_id))
  with check (is_engagement_member(engagement_id));

create policy "context_materials_rw" on context_materials
  for all using (is_engagement_member(engagement_id))
  with check (is_engagement_member(engagement_id));

create policy "business_context_cards_rw" on business_context_cards
  for all using (is_engagement_member(engagement_id))
  with check (is_engagement_member(engagement_id));
