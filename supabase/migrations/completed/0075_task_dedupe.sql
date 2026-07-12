-- ============================================================
-- Task de-duplication: idempotency key for createTask.
--
-- A per-form client-generated id lets a retried / double-fired /
-- double-clicked "New task" submit resolve to the SAME task instead
-- of inserting a second row. The server sets this on insert and, on
-- a unique violation, returns the already-created task.
--
-- Partial unique index (WHERE client_request_id is not null) so:
--   * every existing row (null) is untouched,
--   * batch inserts that leave it null (Granola/transcript drafts,
--     quote seeding) are unaffected,
--   * only client-keyed manual creates are de-duplicated.
--
-- Near-duplicate detection (fuzzy title match against open tasks) is
-- handled in application code, not here — it warns rather than blocks,
-- so legitimately-repeated titles stay allowed.
-- ============================================================

alter table tasks
  add column if not exists client_request_id uuid;

create unique index if not exists tasks_client_request_uniq
  on tasks (client_request_id)
  where client_request_id is not null;
