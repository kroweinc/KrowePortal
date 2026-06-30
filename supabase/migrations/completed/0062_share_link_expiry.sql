-- Share-link expiry + revocation for token-gated public documents.
--
-- Tokens on contracts/quotes/prds/builder_profiles previously never expired, so a
-- leaked link worked forever. Add a 90-day expiry and an explicit revocation
-- timestamp. The public lookups reject a row whose token_revoked_at is set or
-- whose token_expires_at is in the past.
--
-- NOTE: `add column ... not null default` backfills existing rows, so links that
-- already exist get 90 days from the time this migration runs (not instant
-- breakage). New rows get 90 days from creation.

alter table contracts
  add column if not exists token_expires_at timestamptz not null default (now() + interval '90 days'),
  add column if not exists token_revoked_at timestamptz;

alter table quotes
  add column if not exists token_expires_at timestamptz not null default (now() + interval '90 days'),
  add column if not exists token_revoked_at timestamptz;

alter table prds
  add column if not exists token_expires_at timestamptz not null default (now() + interval '90 days'),
  add column if not exists token_revoked_at timestamptz;

-- Builder profiles are meant to be a durable, shareable portfolio link, so they
-- get a longer default horizon but the same revocation switch.
alter table builder_profiles
  add column if not exists token_expires_at timestamptz not null default (now() + interval '365 days'),
  add column if not exists token_revoked_at timestamptz;
