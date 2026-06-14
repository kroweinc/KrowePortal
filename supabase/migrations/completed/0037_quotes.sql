-- ============================================================
-- Quotes — builder-authored pricing quote breakdowns, outbound.
--
-- A richer, PRD-style sibling of the legacy brief (which still owns the
-- `briefs` table and the /quote routes). A Quote is the client-facing
-- PRICE breakdown: a total, a product-level cost table, per-module
-- line-item tables, a design-system inclusion list, a payment-milestone
-- schedule, price justification, and scope protection — "Prepared from
-- the … PRD".
--
-- Always project-scoped (no engagement). The builder drafts a quote from
-- an existing PRD, from scratch (interview), or from raw notes
-- (AI-assisted), edits the dollar amounts inline, "sends" it, and the
-- prospect can view + e-sign it via the public token page. Like a PRD,
-- signing provisions nothing — it is purely an acceptance/sign-off.
--
-- content is JSONB (QuoteContent) so the breakdown can evolve per
-- document. source_notes retains the raw notes / Q&A transcript the AI
-- drafted from (enabling re-generation); source_prd_id records the PRD a
-- quote was priced from. Signature columns mirror prds/briefs for a
-- shared public sign surface.
-- ============================================================

create table quotes (
  id                uuid        primary key default gen_random_uuid(),
  project_id        uuid        not null references projects(id) on delete cascade,
  created_by        uuid        not null references profiles(id),
  title             text        not null,
  status            text        not null default 'draft'
                                check (status in ('draft', 'sent', 'signed', 'accepted', 'rejected')),
  content           jsonb       not null default '{}'::jsonb,
  source_notes      text,
  source_prd_id     uuid        references prds(id) on delete set null,
  token             text        unique not null default encode(gen_random_bytes(32), 'hex'),
  sent_at           timestamptz,
  signed_by_name    text,
  signed_at         timestamptz,
  signer_ip         text,
  signature_consent boolean     not null default false,
  accepted_at       timestamptz,
  rejected_at       timestamptz,
  rejection_note    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index quotes_project_idx    on quotes (project_id, created_at desc);
create index quotes_token_idx      on quotes (token);
create index quotes_source_prd_idx on quotes (source_prd_id);

alter table quotes enable row level security;

-- Single full-access policy: only the owning builder. Status transitions
-- are enforced server-side (mirrors prds_rw). Public token reads go
-- through the admin client in the public action — no SELECT policy.
create policy "quotes_rw" on quotes
  for all using (is_project_owner(project_id))
  with check (is_project_owner(project_id) and created_by = auth.uid());
