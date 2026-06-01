-- ============================================================
-- Contracts — builder-authored services agreements, outbound.
--
-- Always project-scoped (no engagement). The builder drafts a contract
-- from raw notes (AI-assisted, optionally seeded from the project's
-- quote), edits it, "sends" it, and the prospect e-signs it via the
-- public token page. Signing a contract provisions nothing — it is
-- purely the e-signature/execution of the agreement.
--
-- Structurally identical to prds (0035): JSONB content (ContractContent),
-- source_notes for re-generation, and signature columns mirroring briefs.
-- ============================================================

create table contracts (
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
create index contracts_project_idx on contracts (project_id, created_at desc);
create index contracts_token_idx   on contracts (token);

alter table contracts enable row level security;

create policy "contracts_rw" on contracts
  for all using (is_project_owner(project_id))
  with check (is_project_owner(project_id) and created_by = auth.uid());
