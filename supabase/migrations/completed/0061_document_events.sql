-- ============================================================
-- Document Events — append-only lifecycle history for every outbound
-- document (PRD / quote / contract / brief / change order).
--
-- The document tables themselves only record FINAL state: a status plus
-- terminal timestamps (sent_at / signed_at / accepted_at / rejected_at) and a
-- free-text rejection_note. That loses the story — when a doc was sent, when
-- the operator asked for changes and what they were, when it was re-sent, and
-- so on. This table is the missing event log: one immutable row per discrete
-- lifecycle event, powering the per-document timeline in the Context graph.
--
-- Scope: every event is denormalized onto its ENGAGEMENT (engagement_id),
-- resolved at write time. PRDs/quotes/contracts hang off a PROJECT, but a
-- project is 1:1 with an engagement (engagements.project_id, unique), so we
-- bind each event to that engagement. This keeps RLS + the timeline query
-- engagement-scoped and cheap. doc_id is polymorphic across five tables, so it
-- is intentionally NOT a foreign key; document deletion emits a `deleted`
-- event rather than relying on cascade.
--
-- Builder-only, mirroring the context layer (0059): readable by the
-- engagement's builder via is_engagement_builder(). Append-only, mirroring the
-- task audit log (0018): no update/delete policies. Server-side writers use the
-- service-role admin client (bypasses RLS) exactly like sync-document.ts, and
-- enforce authorization in the calling action; the RLS policies are a backstop.
-- ============================================================

create table if not exists document_events (
  id             uuid        primary key default gen_random_uuid(),
  engagement_id  uuid        not null references engagements(id) on delete cascade,
  doc_kind       text        not null
                 check (doc_kind in ('prd','quote','contract','brief','change_order')),
  doc_id         uuid        not null,   -- polymorphic across the 5 doc tables; not an FK
  event_type     text        not null
                 check (event_type in
                   ('created','sent','viewed','changes_requested',
                    're_sent','accepted','signed','rejected','deleted')),
  actor_id       uuid        references profiles(id),  -- nullable: anon/system/backfill rows
  actor_role     text        check (actor_role in ('builder','operator','client','system')),
  -- freeform event detail, e.g. {"changesText":"…"}, {"signerName":"…","signerIp":"…"},
  -- {"rejectionNote":"…"}, {"accepted":true}
  payload        jsonb       not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists document_events_doc_idx
  on document_events (doc_kind, doc_id, created_at);
create index if not exists document_events_engagement_idx
  on document_events (engagement_id, created_at desc);

alter table document_events enable row level security;

-- BUILDER-ONLY, mirroring context_items (0059). Append-only: no update/delete.
create policy "document_events_select" on document_events
  for select using (is_engagement_builder(engagement_id));
create policy "document_events_insert" on document_events
  for insert with check (is_engagement_builder(engagement_id));

-- ============================================================
-- Historical backfill — synthesize a timeline for documents that predate this
-- table from their existing timestamp columns. Idempotent on first apply (the
-- table is empty); each insert guards against a re-run via NOT EXISTS so the
-- migration is safe to replay. Project-scoped docs resolve their engagement
-- through engagements.project_id; briefs/change_orders are engagement-scoped.
-- ============================================================

-- ── PRDs (project-scoped) ──────────────────────────────────────────────
insert into document_events (engagement_id, doc_kind, doc_id, event_type, actor_role, created_at, payload)
select e.id, 'prd', p.id, 'created', 'builder', p.created_at, '{}'::jsonb
from prds p join engagements e on e.project_id = p.project_id
where not exists (select 1 from document_events de
  where de.doc_kind = 'prd' and de.doc_id = p.id and de.event_type = 'created');

insert into document_events (engagement_id, doc_kind, doc_id, event_type, actor_role, created_at, payload)
select e.id, 'prd', p.id, 'sent', 'builder', p.sent_at, '{}'::jsonb
from prds p join engagements e on e.project_id = p.project_id
where p.sent_at is not null and not exists (select 1 from document_events de
  where de.doc_kind = 'prd' and de.doc_id = p.id and de.event_type = 'sent');

insert into document_events (engagement_id, doc_kind, doc_id, event_type, actor_role, created_at, payload)
select e.id, 'prd', p.id, 'signed', 'client', p.signed_at,
       jsonb_strip_nulls(jsonb_build_object('signerName', p.signed_by_name))
from prds p join engagements e on e.project_id = p.project_id
where p.signed_at is not null and not exists (select 1 from document_events de
  where de.doc_kind = 'prd' and de.doc_id = p.id and de.event_type = 'signed');

insert into document_events (engagement_id, doc_kind, doc_id, event_type, actor_role, created_at, payload)
select e.id, 'prd', p.id, 'rejected', 'client', p.rejected_at,
       jsonb_strip_nulls(jsonb_build_object('rejectionNote', p.rejection_note))
from prds p join engagements e on e.project_id = p.project_id
where p.rejected_at is not null and not exists (select 1 from document_events de
  where de.doc_kind = 'prd' and de.doc_id = p.id and de.event_type = 'rejected');

-- ── Contracts (project-scoped) ─────────────────────────────────────────
insert into document_events (engagement_id, doc_kind, doc_id, event_type, actor_role, created_at, payload)
select e.id, 'contract', c.id, 'created', 'builder', c.created_at, '{}'::jsonb
from contracts c join engagements e on e.project_id = c.project_id
where not exists (select 1 from document_events de
  where de.doc_kind = 'contract' and de.doc_id = c.id and de.event_type = 'created');

insert into document_events (engagement_id, doc_kind, doc_id, event_type, actor_role, created_at, payload)
select e.id, 'contract', c.id, 'sent', 'builder', c.sent_at, '{}'::jsonb
from contracts c join engagements e on e.project_id = c.project_id
where c.sent_at is not null and not exists (select 1 from document_events de
  where de.doc_kind = 'contract' and de.doc_id = c.id and de.event_type = 'sent');

insert into document_events (engagement_id, doc_kind, doc_id, event_type, actor_role, created_at, payload)
select e.id, 'contract', c.id, 'signed', 'client', c.signed_at,
       jsonb_strip_nulls(jsonb_build_object('signerName', c.signed_by_name))
from contracts c join engagements e on e.project_id = c.project_id
where c.signed_at is not null and not exists (select 1 from document_events de
  where de.doc_kind = 'contract' and de.doc_id = c.id and de.event_type = 'signed');

insert into document_events (engagement_id, doc_kind, doc_id, event_type, actor_role, created_at, payload)
select e.id, 'contract', c.id, 'rejected', 'client', c.rejected_at,
       jsonb_strip_nulls(jsonb_build_object('rejectionNote', c.rejection_note))
from contracts c join engagements e on e.project_id = c.project_id
where c.rejected_at is not null and not exists (select 1 from document_events de
  where de.doc_kind = 'contract' and de.doc_id = c.id and de.event_type = 'rejected');

-- ── Quotes (project-scoped; adds `accepted`) ───────────────────────────
insert into document_events (engagement_id, doc_kind, doc_id, event_type, actor_role, created_at, payload)
select e.id, 'quote', q.id, 'created', 'builder', q.created_at, '{}'::jsonb
from quotes q join engagements e on e.project_id = q.project_id
where not exists (select 1 from document_events de
  where de.doc_kind = 'quote' and de.doc_id = q.id and de.event_type = 'created');

insert into document_events (engagement_id, doc_kind, doc_id, event_type, actor_role, created_at, payload)
select e.id, 'quote', q.id, 'sent', 'builder', q.sent_at, '{}'::jsonb
from quotes q join engagements e on e.project_id = q.project_id
where q.sent_at is not null and not exists (select 1 from document_events de
  where de.doc_kind = 'quote' and de.doc_id = q.id and de.event_type = 'sent');

insert into document_events (engagement_id, doc_kind, doc_id, event_type, actor_role, created_at, payload)
select e.id, 'quote', q.id, 'signed', 'client', q.signed_at,
       jsonb_strip_nulls(jsonb_build_object('signerName', q.signed_by_name, 'accepted', true))
from quotes q join engagements e on e.project_id = q.project_id
where q.signed_at is not null and not exists (select 1 from document_events de
  where de.doc_kind = 'quote' and de.doc_id = q.id and de.event_type = 'signed');

-- accepted-but-not-signed quotes (accepted_at set, signed_at null)
insert into document_events (engagement_id, doc_kind, doc_id, event_type, actor_role, created_at, payload)
select e.id, 'quote', q.id, 'accepted', 'client', q.accepted_at, '{}'::jsonb
from quotes q join engagements e on e.project_id = q.project_id
where q.accepted_at is not null and q.signed_at is null and not exists (select 1 from document_events de
  where de.doc_kind = 'quote' and de.doc_id = q.id and de.event_type = 'accepted');

insert into document_events (engagement_id, doc_kind, doc_id, event_type, actor_role, created_at, payload)
select e.id, 'quote', q.id, 'rejected', 'client', q.rejected_at,
       jsonb_strip_nulls(jsonb_build_object('rejectionNote', q.rejection_note))
from quotes q join engagements e on e.project_id = q.project_id
where q.rejected_at is not null and not exists (select 1 from document_events de
  where de.doc_kind = 'quote' and de.doc_id = q.id and de.event_type = 'rejected');

-- ── Briefs (engagement-scoped) ─────────────────────────────────────────
insert into document_events (engagement_id, doc_kind, doc_id, event_type, actor_role, created_at, payload)
select b.engagement_id, 'brief', b.id, 'created', 'builder', b.created_at, '{}'::jsonb
from briefs b
where not exists (select 1 from document_events de
  where de.doc_kind = 'brief' and de.doc_id = b.id and de.event_type = 'created');

insert into document_events (engagement_id, doc_kind, doc_id, event_type, actor_role, created_at, payload)
select b.engagement_id, 'brief', b.id, 'sent', 'builder', b.sent_at, '{}'::jsonb
from briefs b
where b.sent_at is not null and not exists (select 1 from document_events de
  where de.doc_kind = 'brief' and de.doc_id = b.id and de.event_type = 'sent');

insert into document_events (engagement_id, doc_kind, doc_id, event_type, actor_id, actor_role, created_at, payload)
select b.engagement_id, 'brief', b.id, 'accepted', b.accepted_by, 'operator', b.accepted_at, '{}'::jsonb
from briefs b
where b.accepted_at is not null and not exists (select 1 from document_events de
  where de.doc_kind = 'brief' and de.doc_id = b.id and de.event_type = 'accepted');

insert into document_events (engagement_id, doc_kind, doc_id, event_type, actor_role, created_at, payload)
select b.engagement_id, 'brief', b.id, 'rejected', 'operator', b.rejected_at,
       jsonb_strip_nulls(jsonb_build_object('rejectionNote', b.rejection_note))
from briefs b
where b.rejected_at is not null and not exists (select 1 from document_events de
  where de.doc_kind = 'brief' and de.doc_id = b.id and de.event_type = 'rejected');

-- ── Change orders (engagement-scoped; no sent_at column) ───────────────
insert into document_events (engagement_id, doc_kind, doc_id, event_type, actor_role, created_at, payload)
select co.engagement_id, 'change_order', co.id, 'created', 'builder', co.created_at, '{}'::jsonb
from change_orders co
where not exists (select 1 from document_events de
  where de.doc_kind = 'change_order' and de.doc_id = co.id and de.event_type = 'created');

insert into document_events (engagement_id, doc_kind, doc_id, event_type, actor_role, created_at, payload)
select co.engagement_id, 'change_order', co.id, 'signed', 'operator', co.signed_at,
       jsonb_strip_nulls(jsonb_build_object('signerName', co.signed_by_name))
from change_orders co
where co.signed_at is not null and not exists (select 1 from document_events de
  where de.doc_kind = 'change_order' and de.doc_id = co.id and de.event_type = 'signed');

insert into document_events (engagement_id, doc_kind, doc_id, event_type, actor_role, created_at, payload)
select co.engagement_id, 'change_order', co.id, 'rejected', 'operator', co.rejected_at,
       jsonb_strip_nulls(jsonb_build_object('rejectionNote', co.rejection_note))
from change_orders co
where co.rejected_at is not null and not exists (select 1 from document_events de
  where de.doc_kind = 'change_order' and de.doc_id = co.id and de.event_type = 'rejected');
