-- ============================================================
-- Task-lifecycle email notification preferences.
--
-- Extends notification_preferences (0059) with per-user toggles for the
-- builder<->operator task collaboration loop. Same contract as 0059: one row
-- per user, a missing row (or a missing column value) means "on", so users only
-- get a row once they change something. The dispatcher (lib/email/notify.ts)
-- reads the relevant column before sending; keep this list in sync with the
-- NotificationPreferences interface in lib/types.ts and the NotifyType map in
-- lib/email/notify.ts.
--
-- New categories (all default ON):
--   notify_task_approval_requested — a builder sent you a task for review (operator-facing)
--   notify_task_approved           — an operator approved your task        (builder-facing)
--   notify_task_changes_requested  — an operator requested changes         (builder-facing)
--   notify_task_delivered          — a builder marked a task done/delivered (operator-facing)
-- ============================================================

alter table notification_preferences
  add column if not exists notify_task_approval_requested boolean not null default true,
  add column if not exists notify_task_approved           boolean not null default true,
  add column if not exists notify_task_changes_requested  boolean not null default true,
  add column if not exists notify_task_delivered          boolean not null default true;
