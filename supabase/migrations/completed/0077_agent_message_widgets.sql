-- ============================================================
-- Agents Control Center — rendered widgets on assistant messages.
--
-- A read tool (list_tasks) can attach rendered UI — a status-grouped task
-- board — to an assistant turn instead of flattening the tasks to a markdown
-- list. The structured widget payload is stored here so a reloaded run
-- rehydrates the board (getAgentRun → toUIMessages), not just the prose lead.
-- Nullable + additive; mirrors the `sources` jsonb column from 0076.
-- ============================================================

alter table agent_messages add column if not exists widgets jsonb;
