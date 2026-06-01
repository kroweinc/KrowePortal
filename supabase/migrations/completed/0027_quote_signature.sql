-- ============================================================
-- Quote signature — native in-portal e-signature audit fields.
--
-- The operator signs the quote on the public token page with a typed
-- name + consent checkbox. We persist the name, timestamp, signer IP,
-- and consent flag as a lightweight ESIGN-style audit trail.
--
-- A new 'signed' status marks the atomic-provisioning trigger. The
-- legacy 'accepted' status/columns are kept intact for historical rows.
-- ============================================================

alter table briefs
  add column signed_by_name    text,
  add column signed_at         timestamptz,
  add column signer_ip         text,
  add column signature_consent boolean not null default false;

-- Drop the existing status CHECK by its discovered name (the inline
-- constraint from 0023 is auto-named, so resolve it rather than assume).
do $$
declare
  v_constraint text;
begin
  select con.conname into v_constraint
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  where rel.relname = 'briefs'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%status%';
  if v_constraint is not null then
    execute format('alter table briefs drop constraint %I', v_constraint);
  end if;
end $$;

alter table briefs add constraint briefs_status_check
  check (status in ('draft', 'sent', 'signed', 'accepted', 'rejected'));
