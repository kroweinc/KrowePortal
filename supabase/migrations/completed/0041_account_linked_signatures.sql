-- ============================================================
-- Account-linked signatures.
--
-- Today PRD/Quote/Contract signatures record only a typed name + IP
-- (signed_by_name, signer_ip). The portal now gates "Accept & Sign"
-- behind account creation, so a signature can be bound to a real
-- operator profile. signed_by_user_id captures that binding.
--
-- Nullable for backward compatibility (legacy anonymous signatures and
-- unsigned drafts keep null). The public read path is unchanged.
-- ============================================================

alter table prds
  add column if not exists signed_by_user_id uuid references profiles(id);

alter table quotes
  add column if not exists signed_by_user_id uuid references profiles(id);

alter table contracts
  add column if not exists signed_by_user_id uuid references profiles(id);
