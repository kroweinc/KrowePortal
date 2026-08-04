-- ============================================================
-- Email preference for the task comment thread (0082).
--
-- Same contract as 0059/0078: one row per user, a missing row (or a
-- missing column value) means "on", so users only get a row once they
-- change something. lib/email/notify.ts reads this column before
-- sending; keep it in sync with the NotificationPreferences interface
-- in lib/types.ts and the NotifyType map in lib/email/notify.ts.
--
--   notify_task_comment — someone commented on a task you're on
--
-- A comment posted with "Request a change" on does NOT send this mail:
-- it routes through requestTaskChanges, which already sends the
-- changes-requested notification. One event, one email.
-- ============================================================

alter table notification_preferences
  add column if not exists notify_task_comment boolean not null default true;
