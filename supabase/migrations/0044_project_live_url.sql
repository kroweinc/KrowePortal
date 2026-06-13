-- ============================================================
-- Projects: live work URL.
--
-- A dedicated link to the deliverable itself (deployed app, demo,
-- staging site) so anyone viewing the project can click through and
-- interact with the work live. Distinct from website_url, which is
-- the prospect's existing business site.
-- ============================================================

alter table projects add column live_url text;
