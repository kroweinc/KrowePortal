-- ============================================================
-- Granola meeting pages — a task links back to the call it came from.
--
-- Granola has NO shareable URL. GranolaNote is {id, title, created_at,
-- summary, participants} and nothing in the MCP tool set (list_meetings,
-- get_meetings, get_meeting_transcript, list_meeting_folders,
-- get_account_info) produces a link. So the destination is a page we own
-- (/b/meetings/[id]) and the call content has to be SNAPSHOTTED at import
-- rather than linked to or re-fetched on every view.
--
-- The snapshot lives on granola_imports rather than in a new table: that
-- row already IS the per-(note, container) record, it is inserted first in
-- approveGranolaTasks as the atomic dedupe claim, it already has
-- ownership-checked insert RLS from 0068, and it cascades with the
-- engagement. A new table would need a second insert on a latency-tuned
-- path and would have no natural per-engagement scope.
--
-- Snapshot columns are filled for target_kind='engagement' ONLY. Project
-- imports already store the same summary+transcript in
-- project_sop_transcripts.content (importGranolaNoteToProject), so writing
-- them here too would be pure redundancy. That asymmetry is deliberate —
-- please don't "fix" it.
--
-- There is deliberately still NO update policy on granola_imports. The
-- snapshot write runs from an after() callback with no request scope and
-- goes through createAdminClient(), exactly like the tasks_created
-- bookkeeping write already does.
--
-- Keep columns in sync with GranolaImport / Task in lib/types.ts.
-- ============================================================
begin;

-- ------------------------------------------------------------
-- 1. Meeting snapshot on the ledger row.
--
-- All nullable with no defaults, matching the other late-added task
-- columns (branch_name 0069, pinned_at 0077, release_id 0084).
-- transcript_status null = never attempted (every pre-0088 import).
-- ------------------------------------------------------------
alter table granola_imports
  add column if not exists summary             text,
  add column if not exists transcript          text,
  add column if not exists participants        text,
  add column if not exists transcript_status   text,
  add column if not exists snapshot_fetched_at timestamptz;

alter table granola_imports
  drop constraint if exists granola_imports_transcript_status_check;
alter table granola_imports
  add constraint granola_imports_transcript_status_check check (
    transcript_status is null
    or transcript_status in ('captured', 'plan_gated', 'not_ready', 'failed')
  );

comment on column granola_imports.transcript is
  'Snapshot of the call transcript at import (engagement targets only). '
  'Granola gates transcripts to paid tiers, so this is legitimately null '
  'on a free workspace — transcript_status says which.';

-- ------------------------------------------------------------
-- 2. SELECT widened from importer-only to the engagement's builder.
--
-- Strictly builder-only: is_engagement_builder matches on builder_id, so
-- operators still see nothing and a raw transcript never reaches a client.
--
-- Two reasons to widen. The link would otherwise die the moment an
-- engagement is reassigned (user_id is the builder at IMPORT time only).
-- And it repairs a latent bug in getImportedNoteIds: the dedupe unique
-- indexes below are cross-user but that pre-check select was not, so a
-- note imported by a previous builder was invisible to the check and the
-- next builder got a raw unique violation instead of "already imported".
-- ------------------------------------------------------------
drop policy if exists "granola_imports_select" on granola_imports;
create policy "granola_imports_select" on granola_imports
  for select using (
    auth.uid() = user_id
    or (target_kind = 'engagement' and is_engagement_builder(engagement_id))
    or (target_kind = 'project'    and is_project_owner(project_id))
  );

-- ------------------------------------------------------------
-- 3. Task → meeting pointer, and the line the draft came from.
--
-- ON DELETE SET NULL mirrors release_id (0084) and does real work here:
-- approveGranolaTasks releases a failed import by deleting its ledger row,
-- which now unlinks any tasks that did land instead of stranding them
-- pointing at a deleted meeting. Neither failure path needs new code.
--
-- granola_source_quote is the verbatim transcript line the AI drafted the
-- task from (ExtractedTaskDraft.sourceQuote). It was generated and thrown
-- away before now, which is why the backfill below cannot recover it —
-- backfilled tasks get the meeting link with no quote.
-- ------------------------------------------------------------
alter table tasks
  add column if not exists granola_import_id    uuid references granola_imports(id) on delete set null,
  add column if not exists granola_source_quote text;

alter table tasks drop constraint if exists tasks_granola_quote_len;
alter table tasks add constraint tasks_granola_quote_len check (
  granola_source_quote is null or length(granola_source_quote) <= 300
);

create index if not exists tasks_granola_import_idx
  on tasks (granola_import_id) where granola_import_id is not null;

-- ------------------------------------------------------------
-- 4. Scope invariant. tasks_update_builder (0001) allows a builder to
--    update ANY column, so without this anyone could point a task at an
--    arbitrary ledger row id and read a meeting through it.
--
--    Mirrors enforce_release_task_scope (0084) with one deliberate
--    difference: SECURITY DEFINER. That trigger gets away with an invoker
--    function because releases_select is engagement-member-wide; the
--    granola_imports select above is far narrower, and an invoker function
--    would hit RLS on its own lookup and raise a false "does not exist"
--    for any legitimate writer who can't see the row. search_path is
--    pinned, which is the standard hardening for a definer function.
--
--    `update of <cols>` fires only when those columns are in the SET list,
--    so the board's hot status/sort_order writes never pay for it. ON
--    DELETE SET NULL writes a null, so the WHEN clause is false and the
--    trigger stays out of the cleanup path too.
-- ------------------------------------------------------------
create or replace function enforce_granola_import_task_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  imp granola_imports%rowtype;
begin
  select * into imp from granola_imports where id = new.granola_import_id;

  if not found then
    raise exception 'granola import % does not exist', new.granola_import_id;
  end if;

  if imp.target_kind <> 'engagement' then
    raise exception
      'granola import % is a project import; tasks cannot link to it',
      new.granola_import_id;
  end if;

  if imp.engagement_id is distinct from new.engagement_id then
    raise exception
      'granola import % is scoped to engagement %, but task % is scoped to %',
      new.granola_import_id, imp.engagement_id, new.id, new.engagement_id;
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_granola_import_scope on tasks;
create trigger tasks_granola_import_scope
  before insert or update of granola_import_id, engagement_id on tasks
  for each row
  when (new.granola_import_id is not null)
  execute function enforce_granola_import_task_scope();


-- ============================================================
-- BACKFILL — link already-imported tasks to their ledger row.
--
-- Exact, not heuristic. createDraftTasks issues ONE batched insert and
-- never sets created_at, which defaults to now() — the TRANSACTION
-- timestamp — so every task from a single approval shares a created_at to
-- the microsecond, and tasks_created is that batch's exact size. The
-- ledger row is inserted in the statement immediately before, so
--   ledger.created_at <= batch.created_at < ledger.created_at + seconds.
--
-- A batch is claimed only on MUTUAL uniqueness: the ledger row must have
-- exactly one candidate batch AND that batch must be claimable by exactly
-- one ledger row. That is what makes it safe against the two real
-- collision sources —
--   * approveExtractedTasks (paste/upload) makes identically-shaped
--     batches with no ledger row at all, and
--   * createTask makes batches of size 1, colliding with a
--     tasks_created = 1 import.
-- Both resolve to "ambiguous, skipped", never a mis-stamp.
--
-- Runs to a fixed point: claiming a batch removes it from every other
-- ledger row's candidate set, which can disambiguate a row that
-- previously overlapped it. Idempotent and safe to re-run — linked ledger
-- rows are excluded, and already-linked tasks shrink their group below
-- tasks_created so it can't re-match.
--
-- updated_at is deliberately NOT bumped: the boards sort on it and a
-- backfill must not reorder history.
-- ============================================================
do $$
declare
  v_pass    int := 0;
  v_stamped int;
begin
  loop
    v_pass := v_pass + 1;

    with ledger as (
      select gi.id, gi.user_id, gi.engagement_id, gi.tasks_created, gi.created_at
      from granola_imports gi
      where gi.target_kind = 'engagement'
        and gi.engagement_id is not null
        and gi.tasks_created > 0
        and not exists (select 1 from tasks t where t.granola_import_id = gi.id)
    ),
    candidate as (
      select l.id            as import_id,
             l.engagement_id as engagement_id,
             l.user_id       as user_id,
             t.created_at    as batch_at
      from ledger l
      join tasks t
        on  t.engagement_id = l.engagement_id
        and t.created_by    = l.user_id
        and t.source        = 'builder_added'
        and t.granola_import_id is null
        and t.created_at   >= l.created_at
        and t.created_at   <  l.created_at + interval '5 minutes'
      group by l.id, l.engagement_id, l.user_id, t.created_at, l.tasks_created
      having count(*) = l.tasks_created
    ),
    ledger_unique as (
      select import_id from candidate group by import_id having count(*) = 1
    ),
    batch_unique as (
      select engagement_id, user_id, batch_at
      from candidate
      group by engagement_id, user_id, batch_at
      having count(*) = 1
    ),
    matched as (
      select c.import_id, c.engagement_id, c.user_id, c.batch_at
      from candidate c
      join ledger_unique lu on lu.import_id = c.import_id
      join batch_unique  bu on  bu.engagement_id = c.engagement_id
                            and bu.user_id       = c.user_id
                            and bu.batch_at      = c.batch_at
    )
    update tasks t
    set granola_import_id = m.import_id
    from matched m
    where t.engagement_id     = m.engagement_id
      and t.created_by        = m.user_id
      and t.created_at        = m.batch_at
      and t.source            = 'builder_added'
      and t.granola_import_id is null;

    get diagnostics v_stamped = row_count;
    exit when v_stamped = 0 or v_pass >= 10;
  end loop;
end $$;

commit;

-- ============================================================
-- Rollback (uncomment to revert):
--
--   update tasks set granola_import_id = null where granola_import_id is not null;
--   drop trigger if exists tasks_granola_import_scope on tasks;
--   drop function if exists enforce_granola_import_task_scope();
--   alter table tasks
--     drop constraint if exists tasks_granola_quote_len,
--     drop column if exists granola_import_id,
--     drop column if exists granola_source_quote;
--   alter table granola_imports
--     drop constraint if exists granola_imports_transcript_status_check,
--     drop column if exists summary,
--     drop column if exists transcript,
--     drop column if exists participants,
--     drop column if exists transcript_status,
--     drop column if exists snapshot_fetched_at;
--   drop policy if exists "granola_imports_select" on granola_imports;
--   create policy "granola_imports_select" on granola_imports
--     for select using (auth.uid() = user_id);
-- ============================================================
