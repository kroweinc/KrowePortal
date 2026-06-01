-- ============================================================
-- Phase 8 — Engagement operating agreement (one row per engagement).
--
-- "How the relationship runs" — captured at sign time, editable after.
--   priority_profile : operator-owned ranking ["quality","speed","cost","security"]
--   warranty_days    : post-launch bug-fix window (default 30)
--   decision_rights  : [{ decision, signer, reviewer, informed }]
--   review_cadence / meeting_schedule : freeform cadence text
--   comm_channels    : [{ channel, purpose }]
--   billing_mode     : 'fixed' | 'hourly' (display-only toggle)
--   monthly_recurring: projected $/mo (display)
--   urgency_multiplier: surcharge factor (default 1.5)
-- ============================================================

create table engagement_agreement (
  engagement_id     uuid        primary key references engagements(id) on delete cascade,
  priority_profile  jsonb       not null default '[]'::jsonb,
  warranty_days     integer     not null default 30,
  decision_rights   jsonb       not null default '[]'::jsonb,
  review_cadence    text,
  meeting_schedule  text,
  comm_channels     jsonb       not null default '[]'::jsonb,
  billing_mode      text        not null default 'fixed'
                                check (billing_mode in ('fixed', 'hourly')),
  monthly_recurring numeric,
  urgency_multiplier numeric    not null default 1.5,
  updated_at        timestamptz not null default now()
);

alter table engagement_agreement enable row level security;

create policy "engagement_agreement_rw" on engagement_agreement
  for all using (is_engagement_member(engagement_id))
  with check (is_engagement_member(engagement_id));
