-- Share links default to "never expire" unless an expiry is explicitly set.
--
-- Reverses the blanket 90/365-day auto-expiry introduced in 0062. A null
-- token_expires_at already means "never expires" everywhere it's read — every
-- public lookup guards with `token_expires_at && new Date(...) < new Date()`,
-- which short-circuits on null. So we just stop stamping a default expiry and
-- make the column nullable; an owner can still revoke a link (token_revoked_at)
-- or set an explicit expiry later.

-- New rows get a non-expiring share token by default.
alter table contracts
  alter column token_expires_at drop not null,
  alter column token_expires_at drop default;

alter table quotes
  alter column token_expires_at drop not null,
  alter column token_expires_at drop default;

alter table prds
  alter column token_expires_at drop not null,
  alter column token_expires_at drop default;

alter table builder_profiles
  alter column token_expires_at drop not null,
  alter column token_expires_at drop default;

-- Existing links were never given an explicitly-chosen expiry — there is no UI
-- to set one, so every current value is just the auto-applied 90/365-day default
-- from 0062. Clear it so already-issued links also follow the new "never expire
-- by default" rule. Drop this block if you'd rather let existing links keep their
-- expiry (revocation still works either way).
update contracts        set token_expires_at = null where token_expires_at is not null;
update quotes           set token_expires_at = null where token_expires_at is not null;
update prds             set token_expires_at = null where token_expires_at is not null;
update builder_profiles set token_expires_at = null where token_expires_at is not null;
