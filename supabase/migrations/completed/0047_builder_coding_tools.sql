-- ============================================================
-- Builder Profile — coding tools the builder owns / builds with
-- (Claude Code, Cursor, Copilot, Vercel, Docker, …). A curated,
-- reorderable list shown on the builder's profile and their public
-- share page, grouped by category. Category is free text validated
-- app-side (see CODING_TOOL_CATEGORIES) so the set can evolve without
-- a migration. Same owner-only RLS as builder_profile_experience.
-- ============================================================

create table if not exists builder_profile_coding_tools (
  id                 uuid primary key default gen_random_uuid(),
  builder_profile_id uuid not null references builder_profiles(id) on delete cascade,
  name               text not null,
  category           text,  -- e.g. 'AI Assistant', 'Editor / IDE'; validated app-side
  url                text,
  display_order      integer not null default 0,
  created_at         timestamptz not null default now()
);

create index if not exists builder_profile_coding_tools_profile_idx
  on builder_profile_coding_tools (builder_profile_id, display_order);

-- RLS: owner-only. Public reads go through the admin client + token.
alter table builder_profile_coding_tools enable row level security;

create policy "builder_profile_coding_tools_all" on builder_profile_coding_tools
  for all using (
    exists (select 1 from builder_profiles bp
            where bp.id = builder_profile_id and bp.user_id = auth.uid())
  )
  with check (
    exists (select 1 from builder_profiles bp
            where bp.id = builder_profile_id and bp.user_id = auth.uid())
  );
