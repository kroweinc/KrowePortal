-- ============================================================
-- Context items — allow the `profile` kind.
--
-- The Client Context Layer (0059) mirrors a builder's outbound documents into
-- context_items so they flow into RAG. This extends the same mechanism to the
-- two people in an engagement: the builder's profile (experience, projects,
-- stack) and the operator's business (who runs it, website, business context)
-- are each serialized to text and upserted as a context_item identified by
-- source_meta = {"source":"profile","role":"builder"|"operator"} — see
-- lib/context/sync-profile.ts. These mirrors are folded onto the builder /
-- operator nodes in the context graph rather than drawn as their own nodes.
--
-- Only the CHECK on `kind` needs to change; everything else (RLS, indexes,
-- chunking, embedding) already accommodates a new kind unchanged.
-- ============================================================

alter table context_items drop constraint if exists context_items_kind_check;

alter table context_items add constraint context_items_kind_check
  check (kind in ('document','sop','transcript','material','note','link','profile'));
