-- ============================================================
-- Granola RLS hardening.
--
-- 1. granola_imports INSERT must verify container ownership. The 0066
--    policy only checked user_id, so any authenticated user could insert
--    a ledger row against someone else's project/engagement via PostgREST
--    and — because the dedupe unique indexes are cross-user — permanently
--    block the victim from importing that note.
-- 2. granola_connections: the encrypted OAuth token columns are
--    server-only (all token reads go through the admin client,
--    lib/granola/connection.ts), so strip them from the authenticated
--    role's column grants. PostgREST can then never return ciphertext,
--    whatever the select policy says. service_role grants are untouched.
-- ============================================================
begin;

drop policy if exists "granola_imports_insert" on granola_imports;
create policy "granola_imports_insert" on granola_imports
  for insert with check (
    auth.uid() = user_id
    and (
      -- granola_import_target_check guarantees exactly one branch applies.
      (target_kind = 'project' and is_project_owner(project_id))
      or (target_kind = 'engagement' and is_engagement_builder(engagement_id))
    )
  );

revoke select on table granola_connections from anon, authenticated;
grant select (id, user_id, connected_at, granola_email, token_expires_at,
              sync_enabled, last_synced_at)
  on granola_connections to authenticated;

commit;
