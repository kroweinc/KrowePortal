-- ============================================================
-- Profile Events — append-only change history for the two people in an
-- engagement: the builder (their profile) and the operator (their business).
--
-- The profile mirror lives as a single serialized context_item per role
-- (sync-profile.ts), which only ever holds CURRENT state. That loses the
-- story — which fields a person changed over time, and what they were before.
-- This table is the missing change log: one immutable row per profile update,
-- whose payload carries the field-level diff
--   { "changes": [ { "field": "...", "removed": [...], "added": [...] }, ... ] }
-- powering the "History" section on the builder/operator nodes in the Context
-- graph.
--
-- Scope: every event is bound to its ENGAGEMENT, like document_events (0061),
-- so RLS + the history query stay engagement-scoped and cheap. Builder-only:
-- readable by the engagement's builder via is_engagement_builder(). Append-only
-- (no update/delete policies). Server-side writers use the service-role admin
-- client (bypasses RLS) and prove ownership in the calling sync path; the RLS
-- policies are a backstop.
-- ============================================================

create table if not exists profile_events (
  id             uuid        primary key default gen_random_uuid(),
  engagement_id  uuid        not null references engagements(id) on delete cascade,
  role           text        not null check (role in ('builder','operator')),
  actor_id       uuid        references profiles(id),  -- nullable: system/backfill rows
  -- field-level diff: {"changes":[{"field":"Headline","removed":[...],"added":[...]}]}
  payload        jsonb       not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists profile_events_engagement_idx
  on profile_events (engagement_id, role, created_at desc);

alter table profile_events enable row level security;

-- BUILDER-ONLY, mirroring document_events (0061). Append-only: no update/delete.
create policy "profile_events_select" on profile_events
  for select using (is_engagement_builder(engagement_id));
create policy "profile_events_insert" on profile_events
  for insert with check (is_engagement_builder(engagement_id));
