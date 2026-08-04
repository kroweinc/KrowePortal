-- ============================================================
-- Release gaps — the "you forgot to create a task" safeguard.
--
-- 0081 catches the opposite mistake: work that finished an OPEN task nobody
-- closed. It matches commits against `status != done` tasks, so it can never
-- see the case here — work that shipped with no task behind it at all. Its
-- task_id IS NULL rows are a cost memo, not a signal: every commit that
-- finished an already-done task lands there too.
--
-- The unit that answers this question is the push. A `releases` row IS one
-- push to main, and the tasks carrying its release_id are exactly the work we
-- accounted for. Ask what the push contained, subtract what those tasks cover,
-- and the remainder is the forgotten work. One proposed task per gap, shown on
-- the Shipped timeline under the push that carried it, with Create / Not needed
-- — it NEVER creates a task on its own.
--
-- Accessed only server-side via the service role. Every read and write goes
-- through a server action that runs its own membership check first.
-- ============================================================

-- The memo. Stamped after every scan INCLUDING one that found nothing, which is
-- the whole reason this stays free: without it, a quiet repo would re-run the
-- model over the same pushes on every staging-board load. Same job the
-- task_id IS NULL rows do in commit_task_matches (0081), one column instead of
-- a table, because a release already has a row to hang it on.
alter table releases
  add column if not exists gaps_scanned_at timestamptz;

comment on column releases.gaps_scanned_at is
  'When this push was scanned for work that shipped without a task. Set even '
  'when the scan found nothing — null means "never looked", not "nothing found". '
  'Null for manual releases and for rows created before 0086.';

create table if not exists release_gaps (
  id              uuid         primary key default gen_random_uuid(),

  -- Cascade: a deleted push takes its unresolved suggestions with it, the same
  -- way a deleted task does in commit_task_matches.
  release_id      uuid         not null references releases(id) on delete cascade,
  engagement_id   uuid         references engagements(id) on delete cascade,
  repo_full_name  text         not null,

  -- The proposed task. Mirrors the TaskDraft shape every other draft in the app
  -- uses (lib/ai/schemas.ts), so accepting is a straight field copy into tasks.
  title           text         not null check (char_length(btrim(title)) between 3 and 300),
  description     text         not null check (char_length(description) <= 2000),
  priority        text         not null default 'medium'
                                 check (priority in ('low', 'medium', 'high', 'urgent')),
  type            text         not null default 'change'
                                 check (type in ('feature', 'bug', 'change')),
  tags            text[]       not null default '{}',
  confidence      text         not null default 'medium'
                                 check (confidence in ('high', 'medium', 'low')),

  -- [{sha, subject, url}] — the commits backing the claim. Shown as evidence on
  -- the card and replayed into task_commits on accept, so accepting costs no
  -- second GitHub call. Denormalized for the same reason releases.merge_subject
  -- is (0085): this must stay readable after the repo is disconnected.
  evidence        jsonb        not null default '[]'::jsonb,
  -- Changed paths that led to the claim, for the card's "what this touched".
  files           text[]       not null default '{}',

  state           text         not null default 'pending'
                                 check (state in ('pending', 'accepted', 'dismissed')),
  -- The task the builder created from this. Set null rather than cascading: if
  -- they later delete the task, the suggestion stays resolved — re-proposing
  -- work someone deliberately removed would be the worst kind of nagging.
  created_task_id uuid         references tasks(id) on delete set null,
  resolved_by     uuid         references profiles(id),
  resolved_at     timestamptz,

  model           text,
  created_at      timestamptz  not null default now()
);

-- The board read is "give me every unresolved gap for these releases".
create index if not exists release_gaps_pending_idx
  on release_gaps (release_id)
  where state = 'pending';

alter table release_gaps enable row level security;

-- No policies defined for authenticated/anon roles.
-- All access is via service role (bypasses RLS), same as commit_task_matches,
-- commit_summaries, repo_branches, and branch_purposes.
