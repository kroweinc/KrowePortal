-- ============================================================
-- Phase 9 — Financial transparency (DISPLAY-ONLY, no payment processor).
--
-- infra_recommendations: builder-recommended third-party services with
-- avg monthly cost; the operator can override with an alternative. The
-- monthly-cost and budget views derive from milestones.source_amount,
-- briefs.content totals, and engagement_agreement — no new ledger needed.
-- ============================================================

create table infra_recommendations (
  id                        uuid        primary key default gen_random_uuid(),
  engagement_id             uuid        not null references engagements(id) on delete cascade,
  category                  text,
  item                      text        not null,
  recommended_monthly       numeric,
  operator_override         text,
  operator_override_monthly numeric,
  accepted                  boolean     not null default false,
  created_by                uuid        not null references profiles(id),
  created_at                timestamptz not null default now()
);
create index infra_recommendations_engagement_idx on infra_recommendations (engagement_id, created_at);

alter table infra_recommendations enable row level security;

create policy "infra_recommendations_rw" on infra_recommendations
  for all using (is_engagement_member(engagement_id))
  with check (is_engagement_member(engagement_id));
