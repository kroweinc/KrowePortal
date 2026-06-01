-- ============================================================
-- Quote public token — a per-brief unguessable token that lets an
-- operator open and sign the quote on a public page WITHOUT an
-- account, mirroring the invitations token model.
--
-- Reuses the same generation primitive as invitations
-- (encode(gen_random_bytes(32),'hex') => 64 hex chars). Public reads
-- go through the admin client (service role), so no RLS change is
-- needed — the token itself is the capability.
-- ============================================================

alter table briefs
  add column token text default encode(gen_random_bytes(32), 'hex');

-- Backfill any pre-existing rows (the volatile default fills new rows,
-- but be explicit so older drafts get a token too).
update briefs set token = encode(gen_random_bytes(32), 'hex') where token is null;

alter table briefs alter column token set not null;
alter table briefs add constraint briefs_token_key unique (token);
create index briefs_token_idx on briefs (token);
