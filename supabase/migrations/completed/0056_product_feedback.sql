-- ============================================================
-- Product Feedback.
--
-- A low-friction channel for any signed-in user (builder or operator)
-- to send the Krowe team feedback on the product: a star rating, a type
-- (bug / idea / other), and a free-text message. One row per submission.
--
-- This first slice is DB-only: the team reads submissions directly in
-- Supabase (table editor / SQL / service role), which bypasses RLS, so no
-- team-facing select policy is needed yet. `user_role` snapshots the
-- submitter's role so the team can segment without a join, and `page_path`
-- records where in the app the feedback was sent from.
-- ============================================================

create table if not exists product_feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  user_role  text not null check (user_role in ('operator', 'builder')),
  category   text not null check (category in ('bug', 'idea', 'other')),
  rating     integer check (rating between 1 and 5),  -- nullable for resilience; form requires it
  message    text not null,
  page_path  text,           -- route the user was on when submitting
  created_at timestamptz not null default now()
);

create index product_feedback_created_idx on product_feedback (created_at desc);

alter table product_feedback enable row level security;

-- Any signed-in user may submit their own feedback; they can read back only
-- their own rows. The team reads everything directly in Supabase (RLS bypassed).
create policy "product_feedback_insert" on product_feedback
  for insert with check (user_id = auth.uid());
create policy "product_feedback_select_own" on product_feedback
  for select using (user_id = auth.uid());
