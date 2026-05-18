-- ============================================================
-- Krowe Portal — Dev Seed
-- Local: IDs must match supabase/migrations/0004_dev_profiles.sql and
--         DEV_PROFILE_IDS in lib/auth.ts (dev auth.users rows).
-- Hosted: if you do not apply 0004, replace op_id/bl_id with real auth.users IDs.
-- ============================================================

do $$
declare
  op_id   uuid := '00000000-0000-0000-0000-000000000001';
  bl_id   uuid := '00000000-0000-0000-0000-000000000002';
  eng_id  uuid;
begin
  -- profiles (only if not already created via onboarding)
  insert into profiles (id, role, display_name)
    values
      (op_id, 'operator', 'Sarah Chen'),
      (bl_id, 'builder',  'Marcus Webb')
  on conflict (id) do nothing;

  -- engagement
  insert into engagements (operator_id, builder_id, title)
    values (op_id, bl_id, 'Inventory Management System')
  returning id into eng_id;

  -- sample tasks
  insert into tasks (engagement_id, title, description, source, status, operator_visible, created_by)
    values
      (eng_id, 'Inventory sheet keeps breaking every quarter',
       'Our Google Sheet formula errors out whenever we add more than 500 rows. We lose an hour fixing it each time.',
       'operator_request', 'inbox', true, op_id),

      (eng_id, 'Client onboarding is all email and spreadsheets',
       'New clients send a PDF, someone copies it into a spreadsheet, someone else emails a welcome kit. Takes 2 days.',
       'operator_request', 'inbox', true, op_id),

      (eng_id, 'Approval requests get lost in Slack',
       'Purchase approvals over $500 need manager sign-off but there is no system — just a Slack message that gets buried.',
       'operator_request', 'in_progress', true, op_id),

      (eng_id, 'Set up Supabase schema and auth',
       'Create profiles, engagements, tasks tables with RLS. Wire up magic-link auth.',
       'builder_added', 'done', false, bl_id),

      (eng_id, 'Wire frontend to live database',
       'Connect operator and builder dashboards to real Supabase queries. Test RLS isolation.',
       'builder_added', 'in_progress', true, bl_id);
end $$;
