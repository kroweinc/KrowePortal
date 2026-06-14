-- ============================================================
-- Builder Profile — a resume-like page a builder curates and
-- shares with clients via a public token link (like contracts).
--
--   • builder_profiles            — one per builder: headline, bio,
--                                   linkedin url, resume file, publish
--                                   toggle + share token
--   • builder_profile_projects    — featured projects; source 'github'
--                                   rows carry a stats snapshot synced
--                                   from the GitHub API (verified),
--                                   'manual' rows are builder-entered
--   • builder_profile_experience  — work history entries
--
-- GitHub stats are snapshotted here so the public page never spends
-- the builder's GitHub token. Public reads bypass RLS via the admin
-- client; the 64-hex token is the capability (see contracts pattern).
-- ============================================================

create table if not exists builder_profiles (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null unique references profiles(id) on delete cascade,
  headline            text,
  bio                 text,
  linkedin_url        text,
  resume_storage_path text unique,
  resume_file_name    text,
  is_published        boolean not null default false,
  token               text not null unique default encode(gen_random_bytes(32), 'hex'),
  github_synced_at    timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists builder_profile_projects (
  id                    uuid primary key default gen_random_uuid(),
  builder_profile_id    uuid not null references builder_profiles(id) on delete cascade,
  source                text not null check (source in ('github', 'manual')),
  name                  text not null,
  description           text,
  url                   text,
  tech                  text[] not null default '{}',
  -- GitHub snapshot fields (source = 'github' only)
  github_repo_id        bigint,
  github_repo_full_name text,
  github_is_private     boolean,
  commit_count          integer,  -- builder's own commits; null = unknown
  languages             jsonb,    -- [{ "name": "TypeScript", "pct": 62 }, ...]
  stars                 integer,
  github_pushed_at      timestamptz,
  display_order         integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint builder_profile_project_source_check check (
    (source = 'github' and github_repo_id is not null and github_repo_full_name is not null)
    or source = 'manual'
  )
);

create unique index if not exists builder_profile_projects_repo_uniq
  on builder_profile_projects (builder_profile_id, github_repo_id)
  where source = 'github';

create index if not exists builder_profile_projects_profile_idx
  on builder_profile_projects (builder_profile_id, display_order);

create table if not exists builder_profile_experience (
  id                 uuid primary key default gen_random_uuid(),
  builder_profile_id uuid not null references builder_profiles(id) on delete cascade,
  role               text not null,
  company            text not null,
  start_label        text,  -- freeform, e.g. "Mar 2022"
  end_label          text,  -- freeform; null renders as "Present"
  description        text,
  display_order      integer not null default 0,
  created_at         timestamptz not null default now()
);

create index if not exists builder_profile_experience_profile_idx
  on builder_profile_experience (builder_profile_id, display_order);

-- RLS: owner-only. Public reads go through the admin client + token.
alter table builder_profiles enable row level security;

create policy "builder_profiles_all" on builder_profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table builder_profile_projects enable row level security;

create policy "builder_profile_projects_all" on builder_profile_projects
  for all using (
    exists (select 1 from builder_profiles bp
            where bp.id = builder_profile_id and bp.user_id = auth.uid())
  )
  with check (
    exists (select 1 from builder_profiles bp
            where bp.id = builder_profile_id and bp.user_id = auth.uid())
  );

alter table builder_profile_experience enable row level security;

create policy "builder_profile_experience_all" on builder_profile_experience
  for all using (
    exists (select 1 from builder_profiles bp
            where bp.id = builder_profile_id and bp.user_id = auth.uid())
  )
  with check (
    exists (select 1 from builder_profiles bp
            where bp.id = builder_profile_id and bp.user_id = auth.uid())
  );

-- ============================================================
-- Storage: private 'resumes' bucket (downloads via admin signed URLs).
--
-- NOT created here — the SQL editor's postgres role doesn't own
-- storage.objects, so policy DDL fails and rolls back the whole
-- migration. The bucket is created via the Storage API instead, and
-- object policies are added in Dashboard → Storage → resumes → Policies:
--   insert: bucket_id = 'resumes' and auth.uid() is not null
--   delete: bucket_id = 'resumes' and auth.uid() is not null
-- ============================================================
