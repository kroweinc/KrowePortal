# Handoff — Granola meeting provenance

**Status:** Phase 6 of 6 complete · **Last updated:** 2026-08-10
**Repo / branch:** `/Users/stevenortega/KrowePortal` · `dev`
**Next up:** Nothing blocking. The only unbuilt item is the cron poller, and it
is deferred on purpose — its open questions are specced at the bottom.

## Phases
| # | Phase | Status |
|---|-------|--------|
| 1 | Schema, RLS, scope trigger + backfill (migration 0088) | ✅ done |
| 2 | Snapshot the call at import, without slowing approval | ✅ done |
| 3 | The meeting page `/b/meetings/[id]` | ✅ done |
| 4 | "From meeting" entry point on the task | ✅ done |
| 5 | Read the call in the sheet first, full page second | ✅ done |
| 6 | Retry control + the 30-day window, measured | ✅ done |

## What this solved

A task drafted from a Granola call was **indistinguishable from one typed by
hand** — same `source: "builder_added"`, same audit metadata, no pointer to the
call. The only record a call had been handled was the `granola_imports` ledger
row, which stored a *count*. And the AI already produced the answer and threw it
away: `ExtractedTaskDraft.sourceQuote` (the verbatim line each task came from)
was rendered in the review dialog and discarded at approval.

Two facts shaped every decision:

1. **Granola exposes no shareable URL.** `GranolaNote` is `{id, title,
   created_at, summary, participants}`; nothing in the MCP tool set
   (`list_meetings`, `get_meetings`, `get_meeting_transcript`,
   `list_meeting_folders`, `get_account_info`) produces a link. So the
   destination had to be a page we own, backed by text we snapshot.
2. **Transcripts are paid-tier gated.** A free workspace gets the summary only.
   The page must render what exists and say *which* reason applies.

## Phase 1 — Schema + backfill (2026-08-07)

**Done:** `granola_imports` gained `summary / transcript / participants /
transcript_status / snapshot_fetched_at`; `tasks` gained `granola_import_id`
(FK, `on delete set null`) + `granola_source_quote` (≤300 check); the select
policy widened; a `security definer` scope trigger; and an exact backfill.

**Files touched:** `supabase/migrations/completed/0088_granola_meeting_link.sql`

**Verified by:** dry run inside a transaction aborted by `raise exception`
carrying the counts (nothing persisted) → `ledger=16 matched=11 unmatched=5
tasks_linked=65 drift=0 leaked=0 project_linked=0`. Applied for real; post-apply
re-check identical (65 tasks / 11 imports / 0 leaked / 0 project-linked, 7 new
columns + trigger present).

**Decisions:**
- **Snapshot on `granola_imports`, not a new table.** That row already *is* the
  per-(note, engagement) record, is inserted first at approval as the atomic
  dedupe claim, already has ownership-checked insert RLS from 0068, and cascades
  with the engagement. A new table would need a second insert on a latency-tuned
  path and would have no natural per-engagement scope.
- **Snapshot columns are engagement-target ONLY.** Project imports already store
  the same text in `project_sop_transcripts.content`. The asymmetry is
  deliberate and called out in the migration header.
- **`granola_import_id`, not a bare note id.** `ledgerRow.id` is already in hand
  at the call site, and a note imported into two engagements would make a bare
  note id ambiguous. `on delete set null` means the existing ledger-release
  paths unlink orphaned tasks for free — neither failure branch needed new code.
- **Widened `granola_imports_select`** to `is_engagement_builder` /
  `is_project_owner`. Still strictly builder-only (matches `builder_id`, so
  operators see nothing). Without it the link dies when an engagement is
  reassigned. Bonus: repairs a latent bug in `getImportedNoteIds`, whose select
  was per-user while the dedupe unique indexes are cross-user.
- **The scope trigger is `security definer`,** unlike `enforce_release_task_scope`
  (0084). That one gets away with an invoker function because `releases_select`
  is member-wide; `granola_imports_select` is far narrower and an invoker
  function would raise a false "does not exist" for a legitimate writer.

**Backfill is exact, not heuristic:** `createDraftTasks` issues ONE batched
insert and never sets `created_at`, which defaults to `now()` — the transaction
timestamp — so every task from an approval shares it to the microsecond, and
`tasks_created` is that batch's exact size. A batch is claimed only on **mutual
uniqueness** (one candidate batch per ledger row AND one ledger row per batch),
which is what makes it safe against `approveExtractedTasks` (identically-shaped
batches with no ledger row) and `createTask` (size-1 batches).

**Gotchas:** the 5 unmatched rows were diagnosed, not guessed: 2 have no
surviving task batch at all, 2 have batches short of `tasks_created` (tasks
deleted since), 1 is genuinely ambiguous (two size-1 batches). Widening the
window to 2h recovers none and makes one *more* ambiguous — 5 minutes is right.
`granola_source_quote` is NOT backfillable; those quotes are gone.

## Phase 2 — Capture the snapshot (2026-08-07)

**Done:** `getNoteWithTranscript` now reports `transcriptOutcome`
(`ok|plan_gated|not_found|empty`) instead of collapsing a plan denial and a
still-processing call into the same empty array. New
`captureGranolaMeetingSnapshot` writes the call onto the ledger row.
`createDraftTasks` stamps `granola_import_id` + `granola_source_quote`;
`approveGranolaTasks` fires the capture from `after()`.

**Files touched:** `lib/granola/client.ts`, `lib/granola/meeting-snapshot.ts`
(new), `lib/actions/granola-import.ts`, `lib/actions/granola-meetings.ts` (new),
`lib/types.ts`, `app/b/page.tsx`, `app/b/staging/page.tsx`.

**Verified by:** live one-shot test against the running server — reset a fixture
to `snapshot_fetched_at = null`, loaded the page, and the capture fired once,
failed against the fake note id, stamped `transcript_status='failed'` **and
preserved** the existing summary (119 chars) and transcript (178 chars). A
second load left the timestamp byte-identical: strictly one-shot.

**Decisions:**
- **Captured after the response, not at draft time.** The transcript is fetched
  and discarded in `resolveGranolaDraft`, and the approve payload doesn't carry
  it — but approval is latency-tuned (`stageTimer("granola-approve")`), so this
  goes in `after()` like the hour estimates. Persisting at draft time was
  rejected: no ledger row exists yet, so it would need a staging table plus a GC
  story, and would store transcripts for every abandoned draft.
- **Admin client for the write, and NO update policy added.** `granola_imports`
  has no UPDATE policy — the same constraint that already routes the
  `tasks_created` bookkeeping write through the admin client — and `after()`
  runs outside request scope. Keeping the posture is deliberate.
- **Failure patches only the status + stamp.** Building the patch conditionally
  is what stops a retry against a down Granola nulling out a snapshot that had
  already succeeded. Proven by the live test above.
- **`snapshot_fetched_at` is stamped on every attempt,** success or failure.
  That is the entire mechanism that keeps the page's auto-capture one-shot.

**Gotchas:** `getGranolaMeeting` re-checks `assertEngagementBuilder` even though
RLS exists — `getClient()` returns a **service-role** client for `DEV_PROFILE_IDS`,
under which RLS doesn't run at all, so that check is the only gate in dev.

## Phase 3 — The meeting page (2026-08-07)

**Done:** `/b/meetings/[id]` — hero (title, date, participants), markdown
Summary, speaker-railed Transcript with the source line highlighted, and "Tasks
from this call" with each task's quote and a jump link.

**Files touched:** `app/b/meetings/[id]/page.tsx` (new),
`components/granola/meeting-view.tsx` (new),
`components/granola/quote-focus.tsx` (new),
`lib/granola/transcript-view.ts` (new), `lib/granola/format.ts` (new),
`lib/ai/extract-tasks-postprocess.ts`, `app/globals.css`,
`tests/transcript-view.test.ts` (new).

**Verified by:** driven live in Chromium against the dev server on :3000
(`dev_role=builder`, scratchpad `meeting-page.mjs`) with a seeded fixture, since
the real imports belong to Steven's account and not the dev builder profile.
Asserted from the live DOM: HTTP 200, h1/date/participants, **sequential
headings** (H1→H2→H3→H2→H2), summary markdown, three transcript lines with the
right speakers, `is-quoted` on both anchored lines, `is-arrived` + `<mark>` on
the exact quoted substring, **focus moved to the arrived line**, correct task
hrefs, `aria-current` on the arrived task, and computed CSS proving the rules
were actually served. Fixture fully removed afterwards (verified 0 rows, 65 real
links intact, 0 leaked). 262 tests pass (25 new), tsc clean, eslint 0 errors.

**Decisions:**
- **`transcriptToPlainText` moved into `transcript-view.ts`.** It is a pure
  formatter that was only `server-only` by association, and no test in this repo
  crosses that boundary. Putting the format's writer next to its parser makes
  them one unit-testable pair that can't drift; `client.ts` re-exports it so
  every import site is unchanged.
- **`normalizeForMatch` is exported from `extract-tasks-postprocess.ts`, not
  moved.** The postprocess is generic (paste/upload transcripts too), so having
  it import from `lib/granola/` would be wrong-direction coupling. A second copy
  of the normalizer would make the highlight disagree with the quote the task
  was extracted against.
- **Quote anchoring is exact-match only** (findAnchorLine's Pass A, no token
  fallback). That fallback exists to *reconstruct* context for the model, where
  a near-miss beats nothing; here a near-miss highlights the wrong sentence and
  lies about provenance. No highlight is the better failure.
- **Light task rows, not `TaskCard`.** `TaskCard` is a draggable client
  component with a delete button, context menu and optimistic status movers, and
  its providers *are* mounted by `app/b/layout.tsx` — so it would render fine,
  making the failure mode "silently wrong affordances" rather than a compile
  error. Rows link to `/b?task=<id>`, which opens the real detail sheet.

**Gotchas:**
- **The speaker-label regex needed a word count, not just a length cap.** A
  40-char cap still let "So here is the thing:" parse as a speaker and swallow
  the first clause into the speaker column. Now capped at 3 words and rejected
  if it ends in sentence punctuation. Caught by a test, not by eye.
- **Heading demotion has to be relative.** A fixed h1→h3 map turns a summary
  that opens at `##` into an h4 directly under this page's h2 — skipping h3.
  `headingShift` offsets so the shallowest heading present lands at h3. The
  first live run shipped the skip; the DOM assertion caught it.
- **The 60-char probe only helps when the quote EXCEEDS 60 chars** — a shorter
  quote makes the probe equal to the needle, so it adds nothing. The first
  version of that test was wrong, not the code.
- **Turbopack skipped the `globals.css` recompile again** — `krowe-mtg-line` was
  in the served chunk but `krowe-meta-cell-link` (a later edit to the same file)
  was at **0**. `rm -rf .next` + `dev` restart fixed it. Grep the SERVED chunk,
  never the source. Note `dev` reported the Mac under memory pressure and tried
  to route to Windows, which was unreachable, so it fell back to local.

## Phase 4 — "From meeting" on the task (2026-08-07)

**Done:** a full-width `krowe-meta-cell` in the detail sheet's Details card,
linking to `/b/meetings/<id>?from=<taskId>`, showing the call title and date.

**Files touched:** `components/task-detail-sheet.tsx`, `app/globals.css`.

**Verified by:** the same live drive — clicked through from the meeting page to
the task, and read back the rendered cell: correct `href` with `?from=`, caption
"From meeting", the call title, the date, `grid-column: 1 / -1`, and
`min-height: 44px` computed.

**Decisions:**
- **Appended last of the half-width cells, with `.full`.** This grid draws
  separators positionally (`:nth-child(odd)` → right border, `:nth-child(n+3)` →
  top border), so inserting anywhere earlier would silently re-parity every cell
  after it. `.full` also zeroes the right border. The Labels cell was switched
  from its inline `style={{gridColumn}}` to the same helper it had been
  shadowing.
- **The focus halo is drawn INSET.** `.krowe-meta-card` is `overflow: hidden`
  and would clip an outward one. Links get no global focus treatment in this
  codebase (only `button`/`select`/checkbox/radio), so every new link class
  declares its own.
- **No chip on the task card.** Provenance is not triage, and unlike
  `DeliveryChips` (which short-circuits unless `status === "done"`) a meeting
  chip would appear on most cards in an engagement that imports calls regularly.
  Escape hatch if discoverability proves weak: a non-interactive 11px
  `AudioLines` in the existing `.krowe-card-meta-left` row.
- **Bulleted lists fixed on `.krowe-mtg-md`, not `.md-content`.** The shared
  class restores list indentation but not the marker (the reset strips
  `list-style`), so summaries read as unlabelled indented lines. Scoping the fix
  avoids silently restyling the operator project README.

## Phase 5 — The call, in the sheet (2026-08-10)

**Done:** "From meeting" no longer leaves the board. A plain click swaps the
sheet body to `MeetingPanel` — hero, participants, summary, the transcript
windowed on the line this task came from, and every task from the call — with a
sub-bar carrying *Back to task* and *Open full page*. The page is unchanged and
still one click (or a ⌘-click on the row) away.

**Files touched:** `components/granola/meeting-parts.tsx` (new),
`components/granola/meeting-panel.tsx` (new),
`components/granola/meeting-view.tsx`, `components/task-detail-sheet.tsx`,
`components/task-board.tsx`, `app/globals.css`.

**Verified by:** driven live in Chromium against :3000 (`dev_role=builder`,
scratchpad `drive.mjs`) with a seeded 4-task / 20-line fixture call — 39
assertions, all green: the row's href unchanged, a plain click staying on `/b`,
the panel's H1→H2→H3 heading order, the sub-bar replacing the tabs and the
footer standing down, 13 of 20 lines windowed with the arrived line marked and
its exact words in a `<mark>`, the expander opening the remaining 7, all four
tasks listed with "This task" on the current one, sibling rows following to
their task, in-place swapping on `/b/staging`, re-entry painting with no
skeleton, and the full page still rendering all 20 lines with its jump links.
Computed CSS read back from the live DOM (21px title, 62px rail, borderless
hero in-sheet, bordered on the page). Fixture fully removed afterwards
(0 rows, 65 real links intact). 269 tests pass, tsc clean, eslint 0 errors.

**Decisions:**
- **The row keeps its `href` and preventDefaults a plain click.** A button
  would have thrown away ⌘/middle-click-to-new-tab and the honest link target;
  modifier clicks still go to the page.
- **A sub-view, not a fifth tab.** The call belongs to one property row, not to
  the task, and a tab would sit next to Comments/Build claiming equal standing.
  The tabs strip is swapped for a sub-bar of the same height and gutter so the
  body doesn't shift, and the footer (Delete task / Comment / Move to…) stands
  down while the call is up — those verbs aren't about what's on screen.
- **The transcript opens windowed** (4 lines of run-up, 8 after) with an
  in-place expander. The page keeps the whole call server-rendered precisely so
  a long one costs no hydration; the sheet has no such luxury, and a preview
  that opens on the moment the task came from is the more useful read anyway.
- **Nothing steals scroll.** `QuoteFocus` is deliberately NOT used here — the
  summary is the point of a preview, and the quoted line is already in view
  under it. On the page, deep-linking into a 2000-line call still earns it.
- **The fetch lives in `TaskDetailBody`, not the panel,** keyed to `task.id`.
  Stepping back to the task and in again is then free; the snapshot is
  immutable text, so one read per task is the honest cache.
- **Shared render moved to `meeting-parts.tsx`.** The subtle half — quote
  anchoring, the `<mark>` split, heading demotion — has to agree with the quote
  the task was extracted against, so page and panel draw from one copy.
- **Sibling rows swap in place only where the host offers a task list**
  (`siblingIds`/`onNavigate`, i.e. `/b/staging`), otherwise they link to
  `/b?task=<id>`. The staging board's list is the staged set, so a call's other
  tasks may genuinely not be there — a button that blanked the sheet would be
  worse than a link.

**Gotchas:**
- **`/b?task=<id>` was a dead link once the board was mounted.** `TaskBoard`
  seeded `selectedId` from the URL at mount only, so a soft navigation to the
  same route changed the URL and nothing else — the panel's sibling links (and
  the meeting page's, from the board) went nowhere. Fixed at the root by
  mirroring `?task=` during render (the `lastTaskParam` adjust-on-render
  pattern the sheet already uses, not an effect, which the `react-hooks`
  set-state-in-effect rule flags). Browser Back/Forward now drives the sheet too.
- **`transcript_status` is `'captured'`, not `'ok'`** — `getNoteWithTranscript`
  reports `transcriptOutcome: "ok"`, and the check constraint takes
  `captured | plan_gated | not_ready | failed`. Seeding `'ok'` fails the
  constraint.
- **The skeleton shares `.krowe-mtg-inline`,** so `waitForSelector(".krowe-mtg-inline")`
  resolves on the placeholder and reads an empty DOM. Wait for
  `:not(.krowe-mtg-load)`. This cost one false FAIL before it was spotted.

## Phase 6 — "Try again", and what the probe found (2026-08-10)

**Done:** `refreshGranolaMeetingSnapshot` finally has a control — `MeetingRetry`,
on both the page and the sheet panel. Running the probe this handoff had been
asking for then changed the shape of the whole phase.

**The probe answered NO, and the old entry's guess was wrong.** `get_meetings`
is bound by the same 30 days as `list_meetings` **even when handed an explicit
note id**. Six live probes against Steven's connection, bracketing the edge:

| age | result |
|---|---|
| 13d, 18d, 29d | found — note + summary returned (`plan_gated` transcript) |
| 31d, 32d, 49d, 66d | `GranolaNotFoundError` |

So a call ages out of reach completely: no summary, no transcript, no retry that
can ever succeed. **12 of the 16 real imports are already past it.** That turned
a nice-to-have retry button into a correctness problem — an aged-out call stamps
`failed`, which reads as "temporary, try again", beside a button that can only
404 forever.

**Files touched:** `components/granola/meeting-retry.tsx` (new),
`components/granola/meeting-parts.tsx`, `meeting-view.tsx`, `meeting-panel.tsx`,
`lib/granola/format.ts`, `lib/granola/client.ts`,
`lib/actions/granola-meetings.ts`, `components/task-detail-sheet.tsx`,
`app/globals.css`, `tests/granola-history-window.test.ts` (new), `DESIGN.md`.

**Verified by:** 9 new unit tests over the window logic (edge bracketed at 29/31
days with fake timers), plus a live Chromium drive of both branches against two
seeded calls — a 4-day-old `failed` one and a 60-day-old one. 12 assertions, all
green: the aged-out call names the window, does **not** claim "couldn't be
reached", and offers no button; the recent one offers "Try again", says
"Checking Granola…" while it waits, reports its outcome instead of sitting
inert, re-enables, and never navigates; the page carries the identical control
and the identical refusal. Fixtures removed (16 imports, 0 fixtures, 65 links
intact). 278 tests pass, tsc clean, eslint 0 errors.

**Decisions:**
- **`GRANOLA_HISTORY_DAYS` lives in `lib/granola/format.ts`, not `client.ts`.**
  The UI has to reason about the window and `client.ts` is `server-only`.
  `client.ts` now points at it from the `time_range` call site so the two can't
  drift.
- **The window is checked FIRST in `absentTranscriptCopy`,** ahead of
  `capturePending` and the status. A pre-0088 import that never captured would
  otherwise promise "reading this call — reload in a moment" for a fetch
  guaranteed to 404.
- **`getGranolaMeeting` no longer fires the auto-capture past the window.** It
  spent an OAuth refresh and an MCP round-trip per view on a known answer, and
  stamping `failed` would have overwritten the honest "aged out" state with a
  misleading one.
- **The same rule guards the action, not just the UI** — a stale page can't
  spend a round-trip on a certain 404, or stamp `failed` over what the import
  did save.
- **The retry always reports its outcome.** A retry that lands on the same
  status changes nothing on screen, and a button that looks inert reads as
  broken. `plan_gated` / `not_ready` / `failed` / `captured` each get a sentence.
- **The panel re-reads through the sheet, not `router.refresh()`.** The sheet
  holds the fetched call in its own state, so the action's `revalidatePath`
  can't reach it; `refetchMeeting` swaps the new copy in without dropping back
  to the skeleton, and stays silent on failure because the button already speaks.
- **`DESIGN.md` line 160 amended, not the stylesheet** (Steven's call). It now
  bans `width`/`height`/`margin` as layout-thrashing and explicitly permits
  `color`/`border-color` easing on hover and focus — which is what every
  surface in this app already does. Also renamed the phantom `--success-light` /
  `--warning-light` / `--danger-light` to the real `-soft` names (the token
  table two hundred lines above already said `-soft`; only the prose disagreed).

**Gotchas:**
- **Turbopack skipped the `globals.css` recompile again.** Phase 5's rules were
  served; the retry block appended minutes later was at **0** in the chunk, so
  the button rendered as bare text with its icon on its own line. A real content
  edit to that file fixed it without needing `rm -rf .next` this time. Grep the
  SERVED chunk (`/_next/static/chunks/%5Broot-of-the-server%5D…css`), never the
  source — this is the third phase in a row it has bitten.
- **`.krowe-mtg-note svg` was too broad** — it painted the retry button's own
  icon `--info` blue. Scoped to `> svg`.
- **The probe needed a throwaway route.** There's no `tsx` in this repo and the
  meeting page can't be loaded as Steven headlessly, so the probe ran through a
  temporary `app/api/dev/granola-probe/route.ts` (read-only, `DEV_TOGGLE_ENABLED`
  gated) against the running server, then was deleted. Same trick works for any
  server-only helper that needs a live connection.

## Open / follow-ups

Phases 1-6 are built and verified. What's left:

- **The `imported_via='cron'` poller — deferred by decision (2026-08-10), not
  forgotten.** It cannot be built without four answers, and guessing them ships
  a background job that writes tasks on its own:
  1. **Cadence** — how often does it poll? Granola's `list_meetings` takes a
     `time_range`, not a cursor, so every run re-reads the whole window and
     leans on the dedupe indexes.
  2. **Targeting** — a Granola note names no engagement. Match on participants,
     on title, on a per-client folder id (`list_meeting_folders` exists), or
     refuse to guess and park unmatched calls somewhere for triage?
  3. **Landing state** — unapproved drafts a builder reviews, or straight into
     the board? The manual flow's whole shape is review-then-approve.
  4. **Notification** — Slack (the KroweOS channel), in-app, or silent?

  Implementation notes that survive whatever is decided: it must thread
  `ledgerRow.id` into `createDraftTasks` and capture the snapshot **inline**
  rather than via `after()`, and it needs an explicit client parameter —
  `createDraftTasks` calls `getClient(profileId)`, which returns a cookie-bound
  client a cron run won't have. It must also skip calls past
  `GRANOLA_HISTORY_DAYS`, which by definition it can't fetch.

- **Steven's Granola workspace is on the free tier**, so transcripts are
  `plan_gated` everywhere — every probe returned 0 transcript segments. The
  meeting page's transcript section will stay empty until the plan changes; the
  summaries (3.5-5k chars) do come through. Nothing to fix, but worth knowing
  before anyone debugs "the transcript is missing".

- **12 of the 16 real imports are past the 30-day window** and can never be
  captured. They render title / date / tasks / whatever the import saved, with
  the "aged out" note. This is now correct behaviour rather than a bug, but it
  does mean the meeting page is thin for anything older than a month.

### Resolved since this doc was written

- ~~`refreshGranolaMeetingSnapshot` has no UI~~ — shipped in Phase 6, on both
  surfaces, with the aged-out refusal.
- ~~Notes older than 30 days are unverified~~ — measured; see the Phase 6 table.
  The old guess that `get_meetings` "should not be range-bound" was **wrong**.
- ~~`DESIGN.md` names tokens that don't exist~~ — the `--space-*` half had
  already been fixed by someone; the `-light` names were renamed in Phase 6.
- ~~Nothing is committed~~ — the feature is committed (see below); the working
  tree still carries unrelated in-flight work from other sessions.
