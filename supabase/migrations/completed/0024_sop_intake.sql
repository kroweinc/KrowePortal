-- ============================================================
-- SOP intake — structured discovery-call notes attached to a brief.
--
-- A builder pastes raw discovery-call notes; the portal's AI parses
-- them into the structured discovery-SOP shape (business context,
-- problem, outcome, scope, stack/access, stakeholders, timeline,
-- risk flags, …). Those fields drive the quote draft.
--
-- One brief has at most one SOP intake, so it lives as a JSONB
-- column on briefs rather than a separate table. It inherits the
-- briefs RLS policies (engagement members read; builder writes).
-- ============================================================

alter table briefs
  add column sop_intake jsonb not null default '{}'::jsonb;
