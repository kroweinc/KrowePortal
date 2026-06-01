-- ============================================================
-- PRDs — builder-authored Product Requirements Documents, outbound.
--
-- Always project-scoped (no engagement). The builder drafts a PRD from
-- raw notes (AI-assisted), edits it, "sends" it, and the prospect can
-- view + e-sign it via the public token page. Unlike a quote, signing a
-- PRD provisions nothing — it is purely an acknowledgement/sign-off.
--
-- content is JSONB (PrdContent) so sections can evolve per document.
-- source_notes retains the raw notes the AI drafted from, enabling
-- re-generation. Signature columns mirror briefs for a shared public
-- sign surface.
-- ============================================================

create table prds (
  id                uuid        primary key default gen_random_uuid(),
  project_id        uuid        not null references projects(id) on delete cascade,
  created_by        uuid        not null references profiles(id),
  title             text        not null,
  status            text        not null default 'draft'
                                check (status in ('draft', 'sent', 'signed', 'rejected')),
  content           jsonb       not null default '{}'::jsonb,
  source_notes      text,
  token             text        unique not null default encode(gen_random_bytes(32), 'hex'),
  sent_at           timestamptz,
  signed_by_name    text,
  signed_at         timestamptz,
  signer_ip         text,
  signature_consent boolean     not null default false,
  rejected_at       timestamptz,
  rejection_note    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index prds_project_idx on prds (project_id, created_at desc);
create index prds_token_idx   on prds (token);

alter table prds enable row level security;

-- Single full-access policy: only the owning builder. Status transitions
-- are enforced server-side (mirrors change_orders_rw).
create policy "prds_rw" on prds
  for all using (is_project_owner(project_id))
  with check (is_project_owner(project_id) and created_by = auth.uid());
