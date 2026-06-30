-- ============================================================
-- Context items — allow the engagement-entity kinds.
--
-- The Client Context Layer (0059) mirrors a builder's outbound documents
-- (0059) and the two people in an engagement (0062, `profile`) into
-- context_items so they flow into RAG. This extends the same mechanism to
-- everything else that happens inside an engagement — briefs, change orders,
-- the operating agreement, deliverables, infra recommendations, tasks,
-- milestones, builder availability, and a consolidated codebase summary — each
-- serialized to text and upserted as a context_item identified by
-- source_meta = {"source":"auto-entity","entity":"<name>","rowId":...}
-- (singletons like the agreement / availability omit rowId). See
-- lib/context/sync-entity.ts and lib/context/serialize-entities.ts.
--
-- Only the CHECK on `kind` needs to change; everything else (RLS, indexes,
-- chunking, embedding) already accommodates new kinds unchanged — proven by
-- 0062 adding `profile`. (context_materials reuse the existing `material`
-- kind; project SOP transcripts reuse `sop`.)
-- ============================================================

alter table context_items drop constraint if exists context_items_kind_check;

alter table context_items add constraint context_items_kind_check
  check (kind in (
    'document','sop','transcript','material','note','link','profile',
    'brief','change_order','agreement','deliverable','infra',
    'task','milestone','availability','codebase'
  ));
