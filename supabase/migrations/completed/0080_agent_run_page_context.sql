-- ============================================================
-- Chat runs remember the page context they were fired from.
--
-- A grounded turn carries a page hint ("the builder is viewing the Tasks board")
-- and, on a document page, the specific document in view — both used to bias the
-- model turn. They were passed per-turn and used once, so a follow-up (especially
-- from the neutral agent workspace /b/agent/[runId], where the client can't
-- re-derive them) dropped the page context and the chat "forgot" where it started.
--
-- Persist them on the run, sticky exactly like project_id (0079): the turn that
-- supplies a new page/document adopts and pins it; a follow-up that supplies none
-- inherits what the run remembers. Both nullable — chat runs off any page and
-- every PRD run simply leave them null, so existing rows backfill unchanged.
-- ============================================================

alter table agent_runs
  add column if not exists page text;

-- The document in view: { "kind": "prd" | "quote" | "contract", "id": "<uuid>" }.
alter table agent_runs
  add column if not exists viewed_doc jsonb;
