# Handoff — Branch staging → release tracking

**Status:** Phase 11 of 11 complete · **Last updated:** 2026-08-01
**Repo / branch:** `/Users/stevenortega/KrowePortal` · `dev`
**Next up:** Nothing blocking. Review the working-tree diff and commit when ready.
One open question for Steven in Phase 11 — which client a gap lands under when
several engagements share a repo.

## Phases
| # | Phase | Status |
|---|-------|--------|
| 1 | Schema + backfill (migration 0084) | ✅ done |
| 2 | Ship write-paths + `lib/actions/releases.ts` | ✅ done |
| 3 | Builder Shipped timeline on `/b/staging` | ✅ done |
| 4 | Operator changelog at `/o/changelog` | ✅ done |
| 5 | Re-key releases: push-to-main, not branch | ✅ done |
| 6 | Scan integration branches for unmarked work | ✅ done |
| 7 | Detect pushes by branch tip, not PRs | ✅ done |
| 8 | Miss-prevention: push dating, background sweep | ✅ done |
| 9 | Split the 80-task Jul 31 blob into real pushes | ✅ done |
| 10 | Group Shipped by day + name each push by its merge | ✅ done |
| 11 | Detect work that shipped with no task (migration 0086) | ✅ done |

## What this solved

`/b/staging` could say "done but not pushed", not "these shipped together on this
date". There was no release entity: `branch_push_marks` kept one **mutable** row
per branch (each merge overwrote the last), `pushed_to_main` was a bare boolean,
and no `shipped_at` existed anywhere. Now every push is a durable row.

## Phase 1 — Schema + backfill (2026-07-31)

**Done:** `releases` table (`auto` | `manual` | `combined`), `tasks.release_id` +
`tasks.shipped_at`, 5 indexes, 4 RLS policies mirroring `staging_groups` (0071),
2 scope triggers, and a best-effort backfill from `task_audit_log`.

**Files touched:** `supabase/migrations/completed/0084_releases.sql`

**Verified by:** dry run of the whole migration inside a transaction aborted by a
`raise exception` carrying the counts (so nothing persisted), then applied for
real. Post-apply: **35 dated · 15 in a release · 0 date-unknown · 0 leakage onto
unshipped tasks**. Backfill signal split: 15 tasks from one `dev` merge on Jul 10
(sha `474bd7b`) → 1 auto release; 17 from `task.completed` audit rows over 10
days; 3 from `completed_at`. All 5 DB invariants confirmed rejecting bad writes
(non-combined parent, cross-engagement attach, auto-without-sha, duplicate sha,
combined-without-title).

**Decisions:**
- **A release never spans engagements** — cross-engagement rows are
  unrepresentable under RLS (operator A would see a title derived from B's work).
  `setTasksPushedToMain` partitions by engagement; `tasks_release_scope` enforces
  it even for the service-role poll.
- **Combine = nullable `combined_into_id` self-reference, one level.** Combining
  never moves a task, so Split is an exact restore by construction.
- **Auto identity is `(engagement_id, repo_full_name, merge_sha)`**, not global
  `(repo, sha)` — two engagements sharing a repo is normal.
- **Both `release_id` and `shipped_at` on tasks.** The backfill can *date* a task
  without being able to *group* it, so `shipped_at` set + `release_id` null is a
  legal state rendered as a per-day bucket.

**Gotchas:** Postgres has no `min(uuid)` — the backfill casts via text (bit twice
during the dry run). Migration applied via the Supabase Management API (no CLI
link); the file was **untracked**, so `git mv` failed and a plain `mv` was used.

## Phase 2 — Ship write-paths (2026-07-31)

**Done:** All four paths now create/attach a release.

**Files touched:** `lib/actions/tasks.ts` (helpers `resolveShipRelease`,
`unanimousGroupName`, `gcEmptyManualReleases`; `markTaskDone` gained an optional
`ship` param; `setTasksPushedToMain` partitions + detaches on Undo;
`pollBranchMerges` claims the merge on the ledger), `lib/actions/commit-task-matches.ts`,
`lib/actions/releases.ts` (new), `lib/types.ts`.

**Verified by:** `npx tsc --noEmit --incremental false` clean; `npx eslint` on all
changed files → 0 errors (2 pre-existing warnings).

**Decisions:**
- **`branch_push_marks` is still written but no longer read.** The unique index is
  set membership over every sha ever shipped — strictly stronger than the old
  single-latest-sha compare. Kept one cycle for revertibility.
- **Release inserts are awaited inline, never in `after()`.** Every other ship
  write defers into `after()` with errors swallowed; that's right for the audit
  log and fatal for a release, so a failed insert must stop the flip.
- **An emptied `kind='auto'` release is never garbage-collected** — it's the
  idempotency tombstone. Only `manual` + `source='app'` empties are swept.

**Gotchas:** supabase-js infers the row type from the `select()` string as a
literal, so `RELEASE_COLUMNS + ", created_by"` widens to `string` and fails the
cast — the with-owner column list is spelled out separately.

**Incidentally fixed:** `fetchMergedPrSha` sorts PRs by *update* time, not merge
time, so a comment on an old merged PR resurfaced its sha and `isNewMerge`
re-shipped work the builder had undone. Any previously-seen sha is now a
permanent no-op.

## Phase 3 — Builder timeline (2026-07-31)

**Done:** `groupTasksByRelease` (releases → per-day pseudo-groups → "Earlier ·
date unknown"), Shipped zone rebuilt with checkbox multi-select → Combine, plus
Split and Rename. Next push is unchanged.

**Files touched:** `lib/tasks/staging-grouping.ts`, `components/staging-board.tsx`,
`app/b/staging/page.tsx`, `app/globals.css` (`.krowe-stage-release`,
`.krowe-stage-rel-*`, `.krowe-stage-combinebar`), `tests/staging-and-branch.test.ts`.

**Verified by:** 184 tests pass (8 new). Live drive on the running dev server
(port 3010): fixture releases rendered as "stripe-billing" (auto, labeled from
branch, meta `stripe-billing · 474bd7b`) and "Terms & onboarding pass" (manual);
combining produced one entry rolling up both children and both tasks; splitting
restored the two separate releases exactly. All fixtures removed afterward — DB
verified back to 1 release / 35 dated / 15 grouped / 0 dangling.

**Decisions:** Tasks inside a combined release keep the caller's completed-desc
order rather than clustering by child release — same within-bucket guarantee
`groupTasksByBranch` makes. Day bucketing uses **UTC** (`shipped_at.slice(0,10)`)
so a client component and its server render never disagree about the date.

## Phase 4 — Operator changelog (2026-07-31)

**Done:** `/o/changelog`, read-only reverse-chron releases with client-facing copy,
plus a "Shipped" sidebar tab.

**Files touched:** `app/o/changelog/page.tsx` (new), `app/o/layout.tsx`,
`components/sidebar.tsx` (added the `rocket` icon key), `app/globals.css`
(`.krowe-chg-*`).

**Verified by:** rendered as `dev_role=operator` → "2 changes across 1 release",
entry "Billing + terms" dated July 9 2026, "Went out together as 2 pushes", both
task titles. Empty state renders after fixture cleanup.

**Decisions:** No visibility filtering needed — `operator_visible` was removed in
0054, so engagement membership is the only gate. `getClientChangelog` drops
releases with zero tasks so a tombstone never reads as a push that shipped nothing.

## Phase 5 — Releases are keyed to the push, not the branch (2026-08-01)

**Done:** A release is now *one merge into main*, containing every task that was
waiting in Next push at that moment — regardless of `branch_name`.

**Why:** Phase 2's poll asked GitHub "is there a merged PR from branch X into the
*default* branch?" and then flipped only tasks tagged X. Under a
feature → `dev` → `main` flow that is wrong twice over: a feature branch's PR
targets `dev`, so `base=main` never matches it and those tasks stay staged
forever, indistinguishable from unmerged work; and when `dev` → `main` finally
lands, the release picks up only tasks literally tagged `dev`. It only appeared
to work because every task in the live engagement was tagged `dev`, `main`, or
nothing. The branch is a label; the merge sha is the identity.

**Files touched:** `lib/github/merged-prs.ts` (`pickMergedSha`/`isNewMerge`/
`getMergedPrSha` → `pickLatestMerge`/`getLatestMainMerge`, now returning
`{sha, headRef, mergedAt}`), `lib/actions/tasks.ts` (`pollBranchMerges` →
`pollMainMerges`), `components/staging-board.tsx`, `lib/types.ts`,
`tests/merged-prs.test.ts`.

**Verified by:** `npx vitest run` → 182 passed / 15 files;
`npx tsc --noEmit --incremental false` clean; `npx eslint` on all changed files →
0 errors (1 pre-existing `set-state-in-effect` warning).

**Decisions:**
- **Membership is "everything in Next push", not branch-verified containment.**
  The compare-API alternative costs one call per branch and squash merges read as
  "not contained" — the exact failure that drove the PR-sha approach originally.
- **One GitHub call per engagement, not per branch.** The PR listing drops its
  `head=` filter, so the poll is strictly cheaper than before.
- **`pickLatestMerge` maxes on `merged_at`** instead of taking the first merged
  row. The listing sorts by *update* time, so a comment on an old merged PR
  floats it to the top; Phase 2 relied on the ledger to absorb that, which meant
  a stale sha could still claim a push.
- **`branch_push_marks` is no longer written.** Its key is
  `(repo_full_name, branch_name)` and the poll no longer has a branch to key on.
  It was already unread since Phase 2; the table itself still needs dropping.

**Gotchas:** The poll fires on `/b/staging` **load**, not just the "Check for
pushes" button — so the backlog sweep below happens the next time that page is
opened, without a click.

## Phase 6 — The forgot-to-mark-done scan looks past main (2026-08-01)

**Done:** `pollCommitTaskMatches` now scans the default branch *plus* up to 3
branches recently merged into it, instead of main alone.

**Why:** The scan existed and ran (6 model calls, 78 commits) but had produced
**0 suggestions ever**. Partly correct — the open items are forward-looking
backlog entries, not forgotten work — but structurally it could only ever see
main, and under feature → dev → main a finished task isn't visible there for
weeks, by which point the builder has noticed themselves.

**Files touched:** `lib/github/merged-prs.ts` (`sortMerges` + `pickMergeHeads`;
one cached PR listing now serves both the ship poll and the scan),
`lib/github/recent-commits.ts` (`getRecentDefaultBranchCommits` →
`getRecentCommitsForBranches`, deduping by sha with first-branch-wins),
`lib/actions/commit-task-matches.ts`, `tests/merged-prs.test.ts`.

**Verified by:** 187 tests pass (5 new); `npx tsc --noEmit --incremental false`
clean; eslint 0 errors. Live check against `Jynx-hub/PatelInternal` with the
stored OAuth token: branch discovery returns
`['claude/ptax-firm-account-error-0m9ss8', 'dev']`, so `dev` is now scanned.

**Decisions:**
- **Branch discovery reuses the merged-PR listing** the ship poll already
  fetches, so adding it cost zero extra GitHub requests. Capped at 3 branches.
- **A non-default-branch commit may not ship a task.** `confirmMatchedTaskDone`
  now resolves the repo, compares `branch_name` to the default, and only passes
  `pushed_to_main: true` + `ship` when they match. A `dev` commit marks the task
  done into Next push instead, and the merge poll ships it later. Without this,
  confirming a `dev` match would have written a sha that isn't on main into the
  release ledger. Fails closed if the repo can't be resolved.

**Gotchas:** `commit_task_matches` is keyed `(repo_full_name, commit_sha)`, so a
commit on both `dev` and `main` is memoized once — hence default-branch-first
ordering, which is what makes the `isLive` check meaningful.

## Phase 7 — A push is the branch tip, not a pull request (2026-08-01)

**Done:** `pollMainMerges` compares the default branch's **tip sha** against the
ledger instead of reading the merged-PR list. Integration-branch discovery for
the Phase 6 scan gained a second, PR-free source.

**Why:** `PatelInternal` has **2 PRs targeting `main` in its entire history**
(#1 from `dev`, Apr 28; #2 from `claude/…`, Jul 11). Steven merges locally and
pushes `main` — including a real push on **Jul 31 16:02** that the PR-based
detector could not see, because no PR exists for it. Phases 2–6 were all reading
a listing that had been frozen since July 11. Phase 6's branch discovery leaned
on the same listing and only found `dev` by luck of one April PR.

**Files touched:** `lib/github/merge-subject.ts` (new — `parseMergedBranch`,
`parseMergeTarget`, `pickIntegrationBranches`), `lib/github/recent-commits.ts`
(`getDefaultBranchTip`, sharing the scan's cache entry),
`lib/actions/tasks.ts`, `lib/actions/commit-task-matches.ts`,
`tests/merge-subject.test.ts` (new).

**Verified by:** 202 tests pass (15 new); tsc clean; eslint 0 errors/0 warnings.
Live check against the repo with the stored token, running the shipped parsing
logic over `main`'s real log: ledger newest `474bd7b` vs main tip `aca974b`
(Jul 31 16:02) → **new push detected: True**, where the PR path saw nothing.
Scan branches resolve to `['main', 'dev']` — `dev` now found from
`Merge branch 'X' into dev` subjects, needing no PR at all.

**Decisions:**
- **Tip sha, not PR merge sha.** Same ledger, same idempotency (set membership
  over shipped shas), one cached request. Works for PR and non-PR flows alike; a
  force-push back to an older tip is a no-op rather than a duplicate release.
- **`getDefaultBranchTip` reuses `cachedFetchBranchCommits`**, so on a board that
  already ran the commit scan the push check costs zero extra GitHub requests.
- **Two sources for integration branches.** Merge-commit targets ("Merge branch
  'AgentPDF' into dev") cover a repo that never opens PRs; merged-PR heads cover
  one that always does. Neither alone is reliable.
- **A release's `branch_name` is null for a plain push.** Only a merge commit
  names a branch. The timeline already falls back to labeling by date, and
  Rename exists for anything better.

**Gotchas:** `parseMergedBranch` reads only the subject line — a merge commit's
body often contains further `Merge branch` lines that would otherwise win.

## Phase 8 — Stop it missing a push next time (2026-08-01)

**Done:** Three safeguards, after Phase 7 fixed *what* to watch.

1. **Releases are dated by the push, not the poll.** `shipped_at` now comes from
   the tip commit (`tip.committedAt`), falling back to `now`.
2. **Detection no longer depends on visiting `/b/staging`.** `sweepMainPushes()`
   runs from `after()` in `app/b/layout.tsx`, so any builder page catches up.
3. **A push can't claim work finished after it.** The flip is filtered by
   `completed_at.is.null,completed_at.lte.<tip date>`.

**Why:** detection is lazy — it fires on a page visit — so `shipped_at: now`
stamped a Friday push with whatever day someone next opened the board, and only
one page did the detecting. Proven live below.

**Files touched:** `lib/actions/tasks.ts` (`pollMainMerges` split into an
auth-free `shipPushedTasks(profileId, ids)` core plus the action and the new
background `sweepMainPushes`), `app/b/layout.tsx`.

**Verified by:** 202 tests pass; tsc clean; eslint 0 errors. The PostgREST `or=`
filter was checked against the live REST API rather than assumed — a malformed
filter would have silently flipped nothing and left an empty tombstone.

**Decisions:**
- **`shipPushedTasks` takes a profile id** instead of reading auth, because
  `redirect()` cannot be called from `after()`. The action keeps the redirect;
  the sweep returns quietly.
- **The sweep is silent and swallows everything.** The Undo toast belongs to the
  staging board, and a background catch-up must never fail a page render.
- **A null `completed_at` still ships.** An unknown date can't disprove
  membership — the same rule `filterCommitMatches` uses for commit dates.

**Gotchas:** the builder layout now performs a write-capable background action on
every page load. It is idempotent against the ledger, but any future change to
`shipPushedTasks` inherits that blast radius.

## Live event — the backlog sweep fired mid-session (2026-08-01)

While Phases 7–8 were being written, `/b/staging` was opened against the running
dev server and the hot-reloaded Phase 7 code did exactly what was predicted:

- Release `856a66e0`, `kind=auto`, sha `aca974b`, **80 tasks**, covering work
  completed **Jun 25 – Jul 30**.
- `shipped_at = 2026-08-01 05:57:52` — the **poll** time, because the Phase 8
  dating fix had not landed yet. The real push was **2026-07-31 16:02:34**.
- Engagement `3bbcc609` is now `done=111 / pushed=111`, zero waiting.

**Corrected (2026-08-01).** Re-dated the release and all 80 tasks to the real
push time, `2026-07-31T16:02:34Z`. Run as one CTE guarded on the exact old
timestamp (`and shipped_at = '2026-08-01 05:57:52.591+00'`), so it matched only
the intended rows and re-running is a no-op → `releases_updated: 1,
tasks_updated: 80`. Post-check: release and its tasks share one date
(`distinct_dates: 1`), the Jul 10 release is untouched, and globally
`shipped_but_undated: 0 / leaked: 0`. `tasks.updated_at` was deliberately left
alone — this is a historical correction, and touching it would reshuffle any
UI ordered by recency.

~~Still true: that one row groups a month of work (Jun 25 – Jul 30) as a single
push.~~ **Superseded by Phase 9**, which split it into the 13 real pushes.

## Phase 9 — Split the Jul 31 blob into the pushes that really carried it (2026-08-01)

**Done:** DB-only historical correction, no code change. Release `856a66e0`'s 80
tasks were redistributed across **13 reconstructed releases** dated Jun 28 –
Jul 30. `856a66e0` itself keeps sha `aca974b` and 0 tasks — it stays as the
idempotency tombstone and `groupTasksByRelease` drops it from the timeline.

**Why:** Steven asked why Jul 31 showed ~80 items when he pushed once. The count
was real but the *date* was an artifact of when detection first ran, not when
work went live.

**Method:** walk `main`'s **first-parent spine** via the GitHub API (a merge into
main collapses to one entry; side-branch commits don't appear — exactly
push granularity). Cluster spine commits into a push when they land within 4h of
each other, with an "into main" merge always closing its cluster. A task went
live at the first push at or after its `completed_at`. Reconstructed releases are
`kind='auto'`, `source='backfill'`, ids `md5('relsplit:'||sha)::uuid`.

**Verified by:** full dry run inside a transaction aborted by `raise exception`
carrying the counts → `left_on_old=0 date_mismatch=0 leaked=0
scope_violations=0`. After applying, `groupTasksByRelease` was driven over the
live rows for engagement `3bbcc609` and labeled exactly as `staging-board.tsx`
does: 23 buckets, May 19 → Jul 30, **111/111 tasks rendered**, no Jul 31 entry.
Globally `shipped_but_undated = 0`.

**Decisions:**
- **Compare timestamps as instants, never as strings.** PostgREST returns
  `2026-07-30 17:07:48+00` and GitHub `2026-07-30T04:19:35Z`; a lexical compare
  sorts `T` (0x54) above the space (0x20), so every same-day push sorted ahead of
  the task it was meant to carry. Caught in the planning script's first run — it
  mis-filed the Jul 30 task and hid one push entirely (12 groups, not 13).
- **Titles left null.** The timeline labels by date, which is the whole point of
  the split; Rename already exists for anything better.
- **`branch_name` null**, consistent with Phase 7 — only a merge commit names a
  branch, and these are keyed to the push.
- **`source='backfill'`** — reconstructed, not observed. Also keeps them clear of
  `gcEmptyManualReleases`, which only sweeps `manual` + `source='app'`.
- **`tasks.updated_at` deliberately untouched** (no trigger on that column was
  confirmed first) — a historical correction must not reshuffle board ordering.

**Gotchas:** `dev_role=builder` resolves to the Dev Builder fixture profile, which
is **not a member of engagement `3bbcc609`** — `/b/staging` rendered a different
engagement's 2 pushes. Verification had to drive `groupTasksByRelease` directly
over service-role rows instead of scraping the page.

**Open:** one lump survives — **47 tasks on Jul 7**, of which **42 share a
13-minute `completed_at` window on Jul 4 (06:42–06:55)**. That is a bulk
mark-done in the portal, so their `completed_at` records data entry, not when the
work happened; the first push after it (Jul 7 `3b999e5`) legitimately carried
them all. Spreading those 42 further would need title↔commit matching
(`commit-task-matches`-style), which is speculative dating rather than recovery.

**Rollback:**
```sql
update tasks t set release_id = '856a66e0-b0d8-4a36-a064-35f77d2b2b75',
                   shipped_at = '2026-07-31T16:02:34Z'
  from releases r
  where r.id = t.release_id and r.source = 'backfill'
    and r.repo_full_name = 'Jynx-hub/PatelInternal'
    and r.shipped_at >= '2026-06-01' and r.merge_sha <> '474bd7b17e538b9af1ebcb453db8b202787a5bea';
delete from releases where source = 'backfill'
  and repo_full_name = 'Jynx-hub/PatelInternal'
  and shipped_at >= '2026-06-01'
  and merge_sha <> '474bd7b17e538b9af1ebcb453db8b202787a5bea';
```

## Phase 10 — Shipped is grouped by day, and each push says which merge it was (2026-08-01)

**Done:** Two changes to the Shipped zone of branch mode.

1. **Day headers.** `groupReleasesByDay` folds the release timeline into
   collapsible per-day sections (`Fri, Jul 31, 2026 · 2 pushes · 9 tasks`).
2. **`releases.merge_subject`** (migration 0085) — the merge commit's subject
   line, now the push's display label, with `branch · sha · time UTC` beneath it.

**Why:** after Phase 9 the timeline was 23 flat rows, several sharing a date and
most labeled *only* by that date — Phase 7 leaves `branch_name` null for a plain
push, so a push showed a date and a 7-char sha and nothing about what it was.
Steven's ask: "make it group by date as well, lets also signify what was what
merge." The subject was already being fetched on every detection
(`getDefaultBranchTip` returns the full message) and thrown away after
`parseMergedBranch` read the branch out of it.

**Files touched:** `supabase/migrations/completed/0085_release_merge_subject.sql`
(new), `lib/github/merge-subject.ts` (`mergeSubject`; `parseMergedBranch` now
also accepts `remote-tracking branch`), `lib/tasks/staging-grouping.ts`
(`groupReleasesByDay`, `ReleaseDay`; label chain gained `merge_subject`),
`components/staging-board.tsx`, `app/globals.css` (`.krowe-stage-day-*`,
`.krowe-stage-rel-meta` replacing `.krowe-stage-rel-date`),
`lib/actions/tasks.ts`, `lib/actions/commit-task-matches.ts`,
`lib/actions/releases.ts`, `lib/types.ts`, both test files.

**Verified by:** 214 tests pass (12 new); `npx tsc --noEmit --incremental false`
clean; eslint 0 errors (1 pre-existing `set-state-in-effect` warning). Backfill
filled **16/16** releases, `still_missing: 0`. Live drive on :3010 with
Playwright: day headers render, collapse flips `aria-expanded`, and the served
CSS chunk was grepped for the new classes (this repo has been bitten by
Turbopack silently skipping a `globals.css` edit). Engagement `3bbcc609`'s real
history regroups to 13 days, with **Jul 11 and Jul 7 correctly showing 2 pushes
each** — the exact rows that were indistinguishable before.

**Decisions:**
- **`merge_subject` is stored, not derived at read time.** A release has to stay
  readable after the repo is disconnected, the token revoked, or the history
  rewritten. The sha stays the identity; this is the human-facing name.
- **Label chain is `title ?? merge_subject ?? branch_name`,** then sha, then the
  kind. A builder's own name still wins.
- **The branch shown in the meta line falls back to re-parsing the subject**
  (`mergedBranch` in the board). Phase 9's reconstructed rows have a null
  `branch_name` while their subject plainly reads "Merge branch 'dev' into
  main" — printing "direct push to main" over that would have been a lie.
- **Days are collapsible but never collapsed by default,** and only the closed
  set is tracked, so a newly-detected push is never hidden.
- **Order is inherited, not recomputed.** `groupTasksByRelease` already sorts
  newest-first; re-sorting in the day grouper would be a second definition of
  "newest" free to drift from the first.

**Follow-up in the same phase — same-day absorption.** Steven flagged Jul 30
rendering as two rows: the real push, and a "Marked live individually · no push
recorded" row beside it holding one task. `groupTasksByRelease` now absorbs a
dated-but-ungrouped task into the day's push **when that day had exactly one**.
Two or more pushes and it stays its own row — choosing between them would be
inventing history — and a day with no push keeps the derived row, which is true.
Absorbed tasks are re-sorted by the caller's incoming order, so a push doesn't
render as "its own tasks, then the strays".

Live shape across engagement `3bbcc609`: Jul 30 (1 push / 1 orphan), Jul 17
(1 / 6) and Jul 16 (1 / 1) absorb — 8 orphans, 3 rows removed; Jul 11 and Jul 7
each have 2 pushes so their single orphan stays split; May 19/25, Jul 21/27 have
no push at all and keep the derived row. 237 tests pass (23 new overall), tsc
clean, eslint clean.

**Gotchas:** `parseMergedBranch` had accepted only `Merge branch '…'` while its
sibling `parseMergeTarget` accepted `remote-tracking` too, so a real merge
commit reported "no branch merged". Harmless while it only fed a label that fell
back to the date; wrong once it feeds a line asserting what was merged.

**Backfill method** (one-off, not committed — same posture as Phase 9): read
`releases` where `merge_sha is not null and merge_subject is null` over
PostgREST with the service-role key, decrypt each builder's GitHub token
(AES-256-GCM, mirroring `lib/crypto.ts`), `GET /repos/{repo}/commits/{sha}`,
write back the first line guarded on `merge_subject=is.null` so a re-run can
only fill a gap. Dry-run first; it resolved all 16 before anything was written.

## Phase 11 — Work that shipped with no task at all (2026-08-01)

**Done:** The inverse safeguard to 0081. On `/b/staging`, a push that carried
work no task describes renders a dashed amber **"Not tracked"** card among its
task cards — a proposed title, description, priority/type/tags, and the commits
and paths it read that from. **Create task** writes the task the builder should
have written; **Not needed** retires the suggestion for good.

**Why:** Steven's ask — *"recognize based on the merge when someone forgot to
create a task… on my latest push I never created a task for the agent PDF."*
0081 cannot answer this: it matches commits against `status != done` tasks, so
work with no task has nothing to match, and its `task_id IS NULL` rows are a cost
memo, not a signal (every commit finishing an already-done task lands there too).

**Files touched:** `supabase/migrations/completed/0086_release_gaps.sql` (new),
`lib/github/push-contents.ts` (new), `lib/ai/find-untracked-work.ts` (new),
`lib/tasks/untracked-filter.ts` (new), `lib/actions/release-gaps.ts` (new),
`lib/actions/get-release-gaps.ts` (new), `components/release-gap-card.tsx` (new),
`lib/ai/schemas.ts` (`UntrackedWorkItem`/`Result`), `lib/ai/prompts.ts`
(`buildUntrackedWorkSystem/UserPrompt`), `lib/actions/tasks.ts`,
`lib/tasks/staging-grouping.ts`, `components/staging-board.tsx`,
`app/b/staging/page.tsx`, `app/globals.css` (`.krowe-gap-*`), `lib/types.ts`,
4 test files + 1 new snapshot.

**Verified by:** 237 tests pass (23 new), `npx tsc --noEmit --incremental false`
clean, eslint 0 errors. Live Playwright drive on :3010 against **real data**:
the scan read push `aca974b` from GitHub, proposed *"Stop copying the firm inbox
on agent reminder emails"* from its commits + paths, and the card rendered under
that push. Accept → task created `done` / `pushed_to_main` / `release_id` set,
`completed_at = shipped_at = 2026-07-31 16:02:34Z` (**the push's date, not
now**), 1 commit linked, 3 audit rows, gap `accepted`; the push went 3 → 4 task
cards and the task appeared on `/o/changelog`. Dismiss → gap `dismissed`, card
gone and still gone after reload. **Steady state proven against `ai_usage`:
9 `find_untracked_work` calls before a full board load, 9 after.**

**Decisions:**
- **The push is the unit, not the commit.** A release row already *is* one push,
  and the tasks carrying its `release_id` are exactly what was accounted for.
  Ask what the push contained, subtract those, and the remainder is the gap.
- **Every push now claims a release row.** `shipPushedTasks` dropped its
  `if (!waiting) continue` short-circuit — that skip was precisely the push where
  nothing was tracked, and it left no row to hang the scan on. The GitHub read is
  `unstable_cache`d 300s and shared with the commit scan.
- **`releases.gaps_scanned_at` is the memo,** stamped even when the scan finds
  nothing — one column instead of 0081's whole table, because a release already
  has a row. Null means "never looked", not "nothing found".
- **Paths, never patches.** `GET /commits/{sha}` on a merge returns the diff
  against the first parent — everything the merge brought in — and `/compare`
  against that parent gives the commits it carried. A path (`app/api/agent/pdf/
  route.ts`) is the strongest available evidence of what shipped; a combined diff
  would be tens of thousands of tokens for the same answer. Capped at 100 files
  **sorted by churn**, because GitHub returns them alphabetically and a plain
  slice keeps everything under `a/` and drops the route that explains the push.
- **`filterUntrackedItems` is the net, pure and OpenAI-free** like
  `commit-match-filter`: hallucinated shas dropped, `low` confidence dropped,
  all-housekeeping commit groups dropped, near-duplicate titles collapsed, cap 4.
- **Dedupe spans the whole repo, and every task status.** The scan runs over
  pushes whose work is *done*, so the task a proposal would duplicate is usually
  a completed one — and one repo commonly backs several engagements, which is why
  `commit-task-matches` dedupes by repo too.
- **One push proposes once.** A push to a shared repo gets a release row per
  engagement; the first release scanned for a `(repo, sha)` claims it and the
  siblings stamp themselves quiet. Without this the same forgotten work appeared
  on three clients' boards — observed live before the guard went in.
- **Accepting dates the task by the push,** never by `now()` — the same
  inversion `shipPushedTasks` guards on the other side. `completion_note` stays
  null because the commit link is the deliverable (as in `confirmMatchedTaskDone`).

**Gotchas:**
- **Turbopack skipped the `globals.css` edit again** — the card rendered with
  zero styling and the served chunk had 0 `krowe-gap` rules. A real content edit
  forced the recompile (44 rules after). Grep the served CSS chunk, don't trust
  the page.
- A zero-task release is still dropped from the timeline *unless* it carries a
  pending gap. An undone release that also contains untracked work will therefore
  reappear as a row — judged correct (the push really did ship untracked work).
- The 30-day window plus 3 releases per poll means a cold start works through its
  backlog a few board loads at a time rather than all at once. Self-limiting and
  intentional; the sibling-claim guard means the AI cost is per distinct sha.

**Open / blocked:** see the shared-repo question in Open / follow-ups below.

## Open / follow-ups

- **Nothing is committed.** All code changes across Phases 5–10 are working-tree
  only; the DB writes (migrations 0084 + 0085, the sweep, the re-date, the
  Phase 9 split, the Phase 10 subject backfill) are live in prod.
- **`/o/changelog` still labels a release `title ?? branch_name`** — it never got
  the `merge_subject` fallback, deliberately: a merge subject is builder-facing
  shorthand, not client copy. `setReleaseNotes` is the client-facing surface.
- **Drop `branch_push_marks`** in a follow-up migration — nothing reads or writes
  it as of Phase 5.
- **Branch renames no longer break shipping** (Phase 5 removed the dependency),
  but `branch_name` is still freeform with no FK (0069, deliberate), so a renamed
  branch shows a stale label on the task.
- `markTaskDone(pushed_to_main: true)` makes one release per task, so marking work
  done individually yields a thin timeline. Combine is the intended remedy.
- **Which client a release gap lands under, when a repo backs several
  engagements** (Phase 11). `Jynx-hub/PatelInternal` currently backs *Shared
  space*, *Patel Internal* and *test*, so one push produces three release rows.
  The guard makes only the first-scanned one propose — correct in that it stops
  triplicate cards, but *which* engagement wins is effectively arbitrary, and
  accepting files the task (and its changelog entry) under that client. Options
  if it misfires: prefer the engagement with the most tasks already on that push,
  or let the card pick a client before creating. Needs Steven's call.
- **Nothing is committed.** All changes are working-tree only.
