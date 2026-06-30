-- Performance indexes for hot filter paths.
--
-- tasks.engagement_id had no index despite being the filter for both the Build
-- Board (app/b/page.tsx) and the task stream (lib/actions/milestones.ts, which
-- also orders by sort_order). The composite covers both.
create index if not exists tasks_engagement_idx on tasks (engagement_id, sort_order);

-- invitations: the reuse query in createInvitation and getMyPendingInvites filter
-- by (engagement_id, status). invitations.token is already indexed via its UNIQUE
-- constraint, so only this composite is missing.
create index if not exists invitations_engagement_status_idx on invitations (engagement_id, status);
