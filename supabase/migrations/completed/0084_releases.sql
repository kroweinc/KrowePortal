-- ============================================================
-- Releases — the durable, append-only ledger of pushes to main.
--
-- Before this, "shipped" was a bare boolean (tasks.pushed_to_main)
-- and the only record of a push was branch_push_marks, which holds
-- ONE mutable row per branch — the third merge into `dev` erased
-- any memory of the first two. So "these four tasks went live on
-- Jul 28, those two on Jul 24" was not reconstructable.
--
-- A release is one push. Three kinds:
--   auto     — a PR merge detected by pollBranchMerges. Carries the
--              merge sha; uniquely identified by it.
--   manual   — the builder asserting "this is live" via the bulk
--              "Mark as pushed to main" button or the done dialog.
--   combined — a builder-named umbrella over >= 2 other releases
--              ("Security + staging UI"). Its children keep their
--              own rows and their own tasks, so Split is lossless.
--
-- Scope rule: a release NEVER spans engagements. Cross-engagement
-- rows are unrepresentable under RLS — operator A would see a title
-- derived from B's work — so setTasksPushedToMain partitions by
-- engagement_id and the tasks_release_scope trigger enforces it even
-- for the service-role poll path.
-- ============================================================

create table releases (
  id               uuid        primary key default gen_random_uuid(),

  -- null = a personal release (the task had no engagement). Mirrors
  -- the tasks.engagement_id convention from 0003.
  engagement_id    uuid        references engagements(id) on delete cascade,

  -- NOT NULL + cascade, unlike staging_groups.created_by (nullable,
  -- set null): for a personal release this column IS the RLS
  -- predicate, so an orphaned row would be invisible and
  -- unmanageable forever.
  created_by       uuid        not null references profiles(id) on delete cascade,

  kind             text        not null check (kind in ('auto', 'manual', 'combined')),

  -- null => the UI derives a label from the branch and date.
  title            text,
  -- Optional client-facing blurb for the operator changelog.
  notes            text,

  repo_full_name   text,
  branch_name      text,
  -- The sha that put this work on the default branch: a merge-commit
  -- sha from pollBranchMerges, or a default-branch commit sha from
  -- confirmMatchedTaskDone.
  merge_sha        text,

  shipped_at       timestamptz not null default now(),

  -- Combine/split. One level only: a combined parent is never itself
  -- combined, so Split always restores the exact pre-combine state.
  combined_into_id uuid        references releases(id) on delete set null,

  source           text        not null default 'app'
                     check (source in ('app', 'backfill')),

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint releases_auto_has_sha
    check ((kind = 'auto') = (merge_sha is not null)),
  constraint releases_auto_has_engagement
    check (kind <> 'auto' or engagement_id is not null),
  constraint releases_no_nesting
    check (kind <> 'combined' or combined_into_id is null),
  constraint releases_combined_has_title
    check (kind <> 'combined' or title is not null),
  constraint releases_title_len
    check (title is null or length(btrim(title)) between 1 and 120),
  constraint releases_notes_len
    check (notes is null or length(notes) <= 4000)
);

-- Auto-release identity. Scoped by engagement, NOT global on
-- (repo, sha): two engagements sharing one repo is normal, and a
-- global key would make the second engagement's poll silently no-op.
--
-- This index is also the idempotency guarantee that replaces reading
-- branch_push_marks: "have we ever shipped this sha for this
-- engagement" as set membership, which survives an Undo (the row
-- stays behind as a tombstone) where a single-latest-sha compare
-- does not.
create unique index releases_merge_sha_key
  on releases (engagement_id, repo_full_name, merge_sha)
  where merge_sha is not null;

create index releases_timeline_idx
  on releases (engagement_id, shipped_at desc);

create index releases_personal_idx
  on releases (created_by, shipped_at desc)
  where engagement_id is null;

create index releases_combined_idx
  on releases (combined_into_id)
  where combined_into_id is not null;

-- ------------------------------------------------------------
-- Task attachment.
--
-- release_id and shipped_at are NOT redundant. The backfill can
-- *date* a task from the audit log without being able to *group* it,
-- so (shipped_at is not null and release_id is null) is a legal,
-- expected state that the timeline renders as a per-day pseudo-group.
--
-- ON DELETE SET NULL mirrors staging_group_id (0071): deleting a
-- release un-files its tasks rather than deleting them.
-- ------------------------------------------------------------
alter table tasks
  add column if not exists release_id uuid references releases(id) on delete set null,
  add column if not exists shipped_at timestamptz;

create index if not exists tasks_release_idx
  on tasks (release_id)
  where release_id is not null;

create index if not exists tasks_shipped_idx
  on tasks (engagement_id, shipped_at desc)
  where pushed_to_main;

-- ------------------------------------------------------------
-- RLS — mirrors staging_groups (0071), plus the personal branch from
-- 0003/0054. SELECT for any engagement member is what gives the
-- operator changelog its read access for free; operators cannot
-- write, since every write policy requires is_engagement_builder.
--
-- Note pollBranchMerges uses the service role and bypasses all of
-- this; its authorization gate is getEngagementRepoById (null for
-- non-members), and the scope invariant is enforced by the trigger
-- below rather than by RLS.
-- ------------------------------------------------------------
alter table releases enable row level security;

create policy "releases_select" on releases
  for select using (
    (engagement_id is not null and is_engagement_member(engagement_id))
    or (engagement_id is null and created_by = auth.uid())
  );

create policy "releases_insert" on releases
  for insert with check (
    created_by = auth.uid()
    and (
      (engagement_id is not null and is_engagement_builder(engagement_id))
      or engagement_id is null
    )
  );

create policy "releases_update" on releases
  for update using (
    (engagement_id is not null and is_engagement_builder(engagement_id))
    or (engagement_id is null and created_by = auth.uid())
  ) with check (
    (engagement_id is not null and is_engagement_builder(engagement_id))
    or (engagement_id is null and created_by = auth.uid())
  );

create policy "releases_delete" on releases
  for delete using (
    (engagement_id is not null and is_engagement_builder(engagement_id))
    or (engagement_id is null and created_by = auth.uid())
  );

-- ------------------------------------------------------------
-- Scope invariants, enforced in the DB because the merge poll runs
-- as the service role and bypasses RLS entirely.
--
-- Both triggers use `update of <cols>`, which fires only when those
-- columns appear in the SET list — so the board's hot
-- status/sort_order/updated_at writes never pay for them.
-- ------------------------------------------------------------
create or replace function enforce_release_task_scope()
returns trigger
language plpgsql
as $$
declare
  rel_engagement uuid;
  found_rel      boolean := false;
begin
  select engagement_id, true into rel_engagement, found_rel
  from releases where id = new.release_id;

  if not found_rel then
    raise exception 'release % does not exist', new.release_id;
  end if;

  if rel_engagement is distinct from new.engagement_id then
    raise exception
      'release % is scoped to engagement %, but task % is scoped to %',
      new.release_id, rel_engagement, new.id, new.engagement_id;
  end if;

  return new;
end;
$$;

create trigger tasks_release_scope
  before insert or update of release_id, engagement_id on tasks
  for each row
  when (new.release_id is not null)
  execute function enforce_release_task_scope();

create or replace function enforce_release_combine_target()
returns trigger
language plpgsql
as $$
declare
  parent releases%rowtype;
begin
  select * into parent from releases where id = new.combined_into_id;

  if not found then
    raise exception 'parent release % does not exist', new.combined_into_id;
  end if;

  if parent.kind <> 'combined' then
    raise exception
      'releases combine only into a kind=combined parent (got %)', parent.kind;
  end if;

  if parent.engagement_id is distinct from new.engagement_id then
    raise exception 'combined release scope mismatch';
  end if;

  return new;
end;
$$;

create trigger releases_combine_target
  before insert or update of combined_into_id, engagement_id on releases
  for each row
  when (new.combined_into_id is not null)
  execute function enforce_release_combine_target();


-- ============================================================
-- BACKFILL — reconstruct ship dates and releases for work that
-- already shipped, from task_audit_log.
--
-- Best-effort and fully reversible:
--   * every reconstructed release carries source = 'backfill'
--   * tasks are only written where shipped_at is null
--   * updated_at is deliberately NOT bumped — the boards sort on it
--     and a backfill must not reorder anyone's history
--   * release ids are a deterministic md5 of the grouping key, so
--     the whole thing is re-runnable and cannot double-insert
--
-- Rollback is at the foot of this file, commented out.
-- ============================================================

-- Step 1 — the ONE winning ship signal per already-shipped task.
-- Precedence:
--   1. latest task.pushed_to_main_changed with new_value = true
--   2. else latest task.completed with metadata.pushed_to_main = true
--   3. else tasks.completed_at
-- A task matching none of the three is not inserted here at all, and
-- ends up in the timeline's "Earlier · date unknown" bucket.
create unlogged table _release_backfill (
  task_id       uuid primary key,
  engagement_id uuid,
  actor_id      uuid,
  shipped_at    timestamptz not null,
  merge_sha     text,
  branch_name   text,
  signal        text not null,
  release_key   text,
  release_id    uuid
);

insert into _release_backfill
  (task_id, engagement_id, actor_id, shipped_at, merge_sha, branch_name,
   signal, release_key, release_id)
select
  t.id,
  t.engagement_id,
  coalesce(pm.actor_id, cm.actor_id),
  coalesce(pm.created_at, cm.created_at, t.completed_at),
  pm.merge_sha,
  coalesce(pm.branch, t.branch_name),
  case
    when pm.created_at is not null then 'push_audit'
    when cm.created_at is not null then 'completed_audit'
    else 'completed_at'
  end,
  k.release_key,
  case
    when k.release_key is null then null
    else md5('rel:' || coalesce(t.engagement_id::text, 'personal')
                    || ':' || k.release_key)::uuid
  end
from tasks t

-- Latest "flipped to pushed" entry. new_value is a raw jsonb boolean
-- (writeAuditEntries stores the JS boolean as-is). Undo rows carry
-- new_value = false and are excluded by design.
left join lateral (
  select l.created_at,
         l.actor_id,
         l.metadata ->> 'merge_sha' as merge_sha,
         l.metadata ->> 'branch'    as branch
  from task_audit_log l
  where l.task_id = t.id
    and l.action = 'task.pushed_to_main_changed'
    and l.new_value = 'true'::jsonb
  order by l.created_at desc
  limit 1
) pm on true

-- Latest "marked done while already pushed" entry — the ship moment
-- for the markTaskDone path, which writes no pushed_to_main_changed.
left join lateral (
  select l.created_at, l.actor_id
  from task_audit_log l
  where l.task_id = t.id
    and l.action = 'task.completed'
    and l.metadata -> 'pushed_to_main' = 'true'::jsonb
  order by l.created_at desc
  limit 1
) cm on true

-- Grouping key.
--   sha:  a PR-merge poll batch (metadata carries merge_sha).
--   bulk: one manual "Mark as pushed to main" click. writeAuditEntries
--         issues a SINGLE multi-row insert and created_at defaults to
--         now() = the transaction timestamp, so every row of one
--         bulk flip shares created_at to the microsecond.
--   null: no groupable evidence — dated, but release-less.
left join lateral (
  select case
    when pm.merge_sha is not null then 'sha:' || pm.merge_sha
    when pm.created_at is not null then
      'bulk:' || pm.actor_id::text || ':' ||
      to_char(pm.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')
    else null
  end as release_key
) k on true

where t.status = 'done'
  and t.pushed_to_main = true
  and coalesce(pm.created_at, cm.created_at, t.completed_at) is not null;

-- Step 2 — one release per (scope, key).
-- Step 1 already collapsed each task to a single winning signal, so a
-- task shipped under sha1, undone, then re-shipped under sha2
-- contributes to sha2 only — no empty backfill release is created and
-- nothing is double-counted.
insert into releases (
  id, engagement_id, created_by, kind, title, repo_full_name,
  branch_name, merge_sha, shipped_at, source, created_at, updated_at
)
select
  b.release_id,
  b.engagement_id,
  -- Postgres has no min(uuid); via text is deterministic and any actor in the
  -- batch is equally correct (a bulk key is one actor's single click anyway).
  min(b.actor_id::text)::uuid,
  case when b.merge_sha is not null then 'auto' else 'manual' end,
  null,
  case when b.merge_sha is not null then e.github_repo_full_name end,
  min(b.branch_name),
  b.merge_sha,
  min(b.shipped_at),
  'backfill',
  min(b.shipped_at),
  min(b.shipped_at)
from _release_backfill b
left join engagements e on e.id = b.engagement_id
where b.release_key is not null
  and b.actor_id is not null
  -- releases_auto_has_engagement: an auto release must be scoped.
  and (b.merge_sha is null or b.engagement_id is not null)
group by b.release_id, b.engagement_id, b.merge_sha, e.github_repo_full_name
on conflict (id) do nothing;

-- Step 3 — stamp the tasks. Fires tasks_release_scope, which
-- re-validates every attachment.
update tasks t
set shipped_at = b.shipped_at,
    release_id = case
      when b.release_id is null then null
      when exists (select 1 from releases r where r.id = b.release_id)
        then b.release_id
      else null
    end
from _release_backfill b
where t.id = b.task_id
  and t.shipped_at is null;

-- Step 4 — a release whose tasks all sit in one staging group takes
-- that group's name as its title.
update releases r
set title = g.name,
    updated_at = now()
from (
  select t.release_id,
         -- No min(uuid); with n_groups = 1 every row carries the same id.
         min(t.staging_group_id::text)::uuid                    as group_id,
         count(distinct t.staging_group_id)                     as n_groups,
         count(*) filter (where t.staging_group_id is null)     as n_ungrouped
  from tasks t
  where t.release_id is not null
  group by t.release_id
) agg
join staging_groups g on g.id = agg.group_id
where r.id = agg.release_id
  and r.source = 'backfill'
  and r.title is null
  and agg.n_groups = 1
  and agg.n_ungrouped = 0;

drop table _release_backfill;


-- ------------------------------------------------------------
-- POST-APPLY CHECK (run separately; not part of the migration)
--
--   select
--     count(*) filter (where shipped_at is not null) as dated,
--     count(*) filter (where release_id is not null) as in_a_release,
--     count(*) filter (where shipped_at is null)     as date_unknown
--   from tasks
--   where status = 'done' and pushed_to_main;
--
-- ROLLBACK (do not run as part of the migration)
--
--   update tasks t set release_id = null, shipped_at = null
--     from releases r where r.id = t.release_id and r.source = 'backfill';
--   update tasks set shipped_at = null
--     where release_id is null and shipped_at is not null;
--   delete from releases where source = 'backfill';
-- ------------------------------------------------------------
