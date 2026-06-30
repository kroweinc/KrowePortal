-- ============================================================
-- Context items — allow the `task_attachment` kind.
--
-- Task attachments (files / links / pasted notes on a task) were previously a
-- dead end for the Client Context Layer: never extracted, never embedded, never
-- RAG-searchable. This extends the same auto-entity mirror mechanism used for
-- tasks/milestones/etc. (0064) to each task attachment — its extractable text is
-- serialized and upserted as a context_item identified by
--   source_meta = {"source":"auto-entity","entity":"task_attachment",
--                  "rowId":<attachmentId>,"taskId":<taskId>}
-- so it flows into RAG and is reconciled on panel-load backfill. The `taskId`
-- rides along so the context graph can hang the attachment node off its task.
-- See lib/context/sync-entity.ts (syncTaskAttachmentContext) and
-- lib/context/serialize-entities.ts (serializeTaskAttachment).
--
-- Only the CHECK on `kind` changes; RLS, indexes, chunking, and embedding already
-- accommodate new kinds unchanged — proven by 0062 / 0064. Non-extractable
-- attachments (images, zip, …) get a graph node but never a mirror, so no row of
-- this kind is empty.
-- ============================================================

alter table context_items drop constraint if exists context_items_kind_check;

alter table context_items add constraint context_items_kind_check
  check (kind in (
    'document','sop','transcript','material','note','link','profile',
    'brief','change_order','agreement','deliverable','infra',
    'task','milestone','availability','codebase',
    'task_attachment'
  ));
