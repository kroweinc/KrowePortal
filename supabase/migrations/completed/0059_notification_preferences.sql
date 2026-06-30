-- ============================================================
-- Notification preferences.
--
-- One row per user (builder or operator) holding per-category email
-- notification toggles. The app's email dispatcher (lib/email/notify.ts)
-- reads the relevant column before sending a transactional email; a missing
-- row means "all on" (defaults below), so users only get a row once they
-- change something. Keep this column list in sync with the
-- NotificationPreferences interface in lib/types.ts and the NotifyType map
-- in lib/email/notify.ts.
--
-- Categories (all default ON):
--   notify_doc_signed      — a quote / contract / PRD you sent was signed
--   notify_change_order    — a change order you sent was signed
--   notify_invite_accepted — an operator accepted your client invite
-- ============================================================

create table if not exists notification_preferences (
  user_id                uuid primary key references profiles(id) on delete cascade,
  notify_doc_signed      boolean not null default true,
  notify_change_order    boolean not null default true,
  notify_invite_accepted boolean not null default true,
  updated_at             timestamptz not null default now()
);

alter table notification_preferences enable row level security;

-- Owner-only: a user reads and writes only their own preference row. The
-- dispatcher reads OTHER users' rows via the service-role admin client
-- (recipient ≠ actor), which bypasses RLS — same pattern as the rest of the app.
create policy "notification_preferences_all" on notification_preferences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
