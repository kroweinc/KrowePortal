-- ============================================================
-- AI usage ledger — per-call token accounting for cost control.
--
-- Every OpenAI call routed through lib/ai/client.ts records its usage
-- here (via the admin client), keyed by the user who triggered it and
-- the engagement it relates to (when known). Backs a coarse per-user
-- daily token budget (assertAiBudget) and after-the-fact spend
-- attribution before GTM scales.
-- ============================================================

create table if not exists ai_usage (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references profiles(id) on delete cascade,
  engagement_id     uuid        references engagements(id) on delete set null,
  operation         text        not null,
  model             text,
  prompt_tokens     integer     not null default 0,
  completion_tokens integer     not null default 0,
  total_tokens      integer     not null default 0,
  created_at        timestamptz not null default now()
);

create index ai_usage_user_created_idx on ai_usage (user_id, created_at desc);

alter table ai_usage enable row level security;

-- Owners can read their own usage. Inserts happen through the admin
-- client (service role bypasses RLS) — no insert policy by design.
create policy "ai_usage_select_own" on ai_usage
  for select using (user_id = auth.uid());
