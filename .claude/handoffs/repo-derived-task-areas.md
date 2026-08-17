# Handoff — Repo-derived task areas replace the fixed tag taxonomy

**Status:** Phase 6 of 6 complete · **Last updated:** 2026-08-12
**Repo / branch:** `/Users/stevenortega/KrowePortal` · `dev`
**Next up:** Nothing blocking. Uncommitted — review this diff and commit.

## Phases
| # | Phase | Status |
|---|-------|--------|
| 1 | Migration 0092 + `resolveAreaVocabulary` seam + derivation | ✅ done |
| 2 | All five classifiers switched to the resolved vocabulary | ✅ done |
| 3 | UI — Granola Area select + `/b/github` Areas card | ✅ done |
| 4 | Bulk re-classify backfill | ✅ done |
| 5 | Verification (tsc, vitest, live drive) | ✅ done |
| 6 | xhigh code review + 15 fixes | ✅ done |

## What this is

The task chip on the build board used to come from a fixed 11-value list in
`lib/types.ts` (`ui`, `backend`, `api`…) — same for every client and repo, so it
described the *shape* of the work but never the *product*. Now each connected
repo gets 6–12 derived product areas (`referrals`, `pg-drive`, `lawsuits`),
cached in `repo_areas`, and every AI classifier picks from those. `TASK_TAGS`
survives as the **fallback** vocabulary when there's no repo / the derivation
failed.

## Architecture (the three things to know)

1. **`lib/tasks/area-vocabulary.ts` is the seam.** `resolveAreaVocabulary({profileId, engagementId})`
   returns `{source: "repo" | "fallback", values}`. It is read-only and cheap (two
   indexed queries, no GitHub, no AI) and **never derives on demand** — deriving
   costs a model call and this sits inside the path that drafts a task from a call.
   Warming is separate: `warmRepoAreas` in `app/b/layout.tsx` via `after()`, or the
   Refresh button on `/b/github`. Worst case is a first-ever classification landing
   on the fallback. The warm only touches repos with **no row in `repo_area_syncs`**
   (0093) and is budget-gated; nothing re-derives on a timer.
2. **Schemas are factories over the allowed slugs** (`lib/ai/schemas.ts`), memoized
   on the joined slug list. `TaskDraft`, `TaskClassifyResult` etc. still exist as
   consts — those are now the *fallback-vocabulary instances*. `tagList` keeps a
   real `z.enum` at runtime (so strict decoding constrains the model) but casts the
   inferred TS type to `string`, because a stored area is a slug from whichever
   vocabulary was live, not a union. **This is also the diff's sharpest trap** —
   a repo slug passed through a fallback const type-checks and fails only at
   runtime. See Phase 6.
3. **The Granola cache prefix is load-bearing.** `EXTRACT_TASKS_SYSTEM_BASE` must
   stay byte-identical across builders and repos, or the cache is worthless. The area
   block is appended AFTER the base, like the builder-identity line, and
   `tests/prompt-snapshots.test.ts` asserts that directly — don't weaken that test.
   The key is `granola-task-extraction-v3-<vocab hash>`: the strict `json_schema`
   carries the repo's tags enum and sits *ahead* of the system message in the cached
   prefix, so one shared key across repos would miss every time.

## Files

**New:** `supabase/migrations/completed/0092_repo_areas.sql` ·
`supabase/migrations/completed/0093_repo_area_syncs.sql` ·
`tests/area-schema-vocabulary.test.ts` ·
`lib/tasks/area-vocabulary.ts` · `lib/ai/derive-repo-areas.ts` ·
`lib/ai/repo-areas-postprocess.ts` (pure guard, no `server-only`, so it's testable) ·
`lib/ai/classify-tasks-bulk.ts` · `lib/actions/repo-areas.ts` ·
`components/repo-page/areas-section.tsx` · `tests/repo-areas-normalize.test.ts`

**Modified:** `lib/ai/prompts.ts` (5 classifier prompts + 2 new) · `lib/ai/schemas.ts` ·
the 5 generators in `lib/ai/` · `lib/actions/tasks.ts` · `lib/actions/classify-task.ts` ·
`lib/granola/draft-core.ts` · `lib/ai/stream-client.ts` · `app/b/layout.tsx` ·
`app/b/github/page.tsx` · `components/granola/*` · `lib/types.ts` · `app/globals.css`

## Verified by

- `npx tsc --noEmit --incremental false` — clean. `npx vitest run` — **317/317**
  (24 files). `npm run lint` — 0 errors (67 pre-existing warnings, none in new files).
- Migrations **0092 and 0093 applied to prod** via the Supabase Management API +
  keychain PAT, then filed to `completed/`. Both tables confirmed present, and
  `repo_area_syncs` backfilled for the repo that already had areas.
- Live: `/b` as `dev_role=builder` → the background warm derived 10 real product
  areas for `Jynx-hub/PatelInternal`. `/b/github` renders the Areas card with both
  buttons. Both pages 200 after the Phase-6 fixes.
- In-process drives (temp tsx scripts, since deleted): the classifier gave
  `referrals` / `pg-drive` / `lawsuits` on matching titles; a profile with no GitHub
  connection resolved `source: fallback` and classified `auth`; a sample call
  transcript extracted 3 drafts, each under a repo area; and post-fix, the approval
  schema accepts a repo-area draft while membership keeps `referrals` and drops
  `pdf-forms`.

## Decisions (don't re-litigate)

- **Keyed on `repo_full_name`, not engagement** — mirrors `repo_branches` (0070);
  two engagements on one repo share a vocabulary and repointing invalidates naturally.
- ~~**Write-path validation is by SHAPE, not membership**~~ — **reversed in Phase 6.**
  The review showed shape-only left the closed list unenforced (any kebab string
  persisted a permanent one-off chip) *and* left `allowedAreaSlugs` dead. Now: shape in
  zod, membership in the action via `sanitizeAreaTags`, dropping unknown slugs to `[]`
  rather than rejecting the write — which keeps the "never blocks an edit" property
  that motivated the original call.
- ~~**24h TTL**~~ — **removed in Phase 6.** No unattended resample at all; see the
  orphaning explanation above. Re-derivation is explicit only.
- **An empty derivation never sweeps existing rows** — "I couldn't tell" ≠ "this repo
  has no areas".
- **Backfill overwrites hand-set areas.** Steven accepted this; there's no way to tell
  a hand-set label from a classifier-set one in `tasks.tags`. The confirm copy says so.
- **`--space-*` tokens added to `:root`.** DESIGN.md documented them from the start
  but `globals.css` never implemented them, so `var(--space-md)` resolved to nothing.
  Added the scale; existing rules left on raw px deliberately (a sweep of ~7900 lines
  is its own change).
- Areas are **derived-only, not hand-editable** in this pass. If the list is wrong the
  fix is Refresh.

## Gotchas

- `lib/ai/repo-areas-postprocess.ts` exists separately from `derive-repo-areas.ts`
  purely because `import "server-only"` breaks under vitest. Same split as
  `extract-tasks-postprocess.ts`. Keep pure logic there.
- Headless tsx drive needs `npx tsx --conditions react-server` (makes `server-only`
  resolve to the empty module) **and** a `.env.local` parser that strips trailing
  `# comments` — `OPENAI_MODEL=gpt-5.4-mini   # defaults to…` otherwise yields
  "invalid model ID".
- Dedupe in `normalizeAreas` is exact-match on the normalized slug, so `"Check_Out"`
  survives alongside `"checkout"`. Deliberate — fuzzy merging would also merge areas
  a repo means to keep apart. Mutual exclusivity is the prompt's job (rule 5).
- Existing tasks keep their old labels until someone runs the backfill; a mixed board
  is expected and harmless (the chip is display-only, nothing filters on it).

## Phase 6 — code review + fixes (2026-08-12)

**Done:** A workflow code review at xhigh (49 agents, 6 finder angles, independent
verify pass) surfaced **15 verified findings**; all 15 are fixed. Two were
feature-breaking for exactly the repos this targets:

- `ApprovedTaskDraftSchema` (granola-import) still validated against the FALLBACK
  `ExtractedTaskDraft` const, so approving any draft carrying a repo area returned
  "Invalid tasks." and created nothing.
- The SSE route's per-item parse had the same bug, so no `task` event ever fired
  and progressive streaming silently degraded to a blocking spinner.

**The trap, stated once:** every schema is a factory over the allowed slugs AND has
a bare const built from the fallback. `tagList` widens the inferred type to
`string[]`, so passing a repo slug through a const is **invisible to tsc** and fails
only at runtime. Rule: any site that parses a model response — or validates
something derived from one — builds its schema from the vocabulary the request used.
`tests/area-schema-vocabulary.test.ts` pins this.

**Also fixed:**
- **Security:** all four `repo-areas.ts` server actions took a caller-supplied
  `engagementId` with no membership check. Added `gateEngagement` (mirrors
  `gateTranscriptTaskDrafting`).
- `/b/github` could hand the write-capable Areas card an engagement that doesn't own
  the on-screen repo (the `engagements.length === 1` fallback), so "Re-file" would
  rewrite the wrong client's board. The card now uses a strict `areasEngagement` and
  hides when scope can't be established.
- **Removed the 24h TTL resample entirely.** It was cargo-culted from `repo_branches`,
  whose upstream is deterministic; a model's isn't. An unattended resample + sweep
  orphaned tasks — *observed live* between two verification runs, where the
  vocabulary drifted from `lawsuits/pg-drive/reporting` to `firm-portal/admin-console/
  property-data`. Re-derivation is now explicit (Refresh) only.
- **Migration 0093 `repo_area_syncs`** (applied + filed): a repo whose derivation
  yields nothing had no rows, so the warm read it as "never attempted" and paid an
  **ungated** GitHub crawl + model call on *every* `/b` load. The ledger records every
  attempt; the warm is now also budget-gated.
- Restored closed-list membership on the write paths via `sanitizeAreaTags`
  (shape in zod, membership in the action, drop-not-reject) — `allowedAreaSlugs` was
  dead code. This reverses the Phase-2 decision below.
- Re-tag capped at `RETAG_MAX_TASKS = 200`, commits per batch instead of all-at-end,
  and groups UPDATEs by area; audit uses `task.field_changed` so it actually renders.
- `RepoAreasResult` bounds removed — they rejected whole derivations before
  `normalizeAreas` could repair them.
- `areaIcon` uses `Object.hasOwn` (a slug named `constructor` white-screened the review).
- `FRAMEWORK_SLUGS` no longer blocks `ui`/`backend`/`packages`/`modules`/`server` —
  legitimate product areas for a design system or monorepo.
- Extraction cache key now carries a vocabulary hash; the per-repo `json_schema` sits
  ahead of the system message in the cached prefix, so one shared key missed every time.
- The new CSS now uses the `--space-*` tokens the same diff introduced.

**Verified by:** `tsc --noEmit --incremental false` clean · `vitest run` 317/317
(24 files) · `npm run lint` 0 errors · live `/b` and `/b/github` 200 with the Areas
card rendering · a headless drive proving the approval schema accepts a repo-area
draft, membership keeps `referrals` and drops `pdf-forms`, and the ledger is populated.

**Gotcha for next time:** my Phase-5 "verified end to end" drove
`extractTasksFromTranscript` directly and never went through `approveGranolaTasks` or
the SSE route — which is exactly why both broke paths passed verification. Drive the
user-facing action, not the library function underneath it.

## Open

- Not committed yet.
- The extraction sample produced 3 builder drafts and did not raise the client's
  "I'll send you the referral IDs" as a separate owner draft. Pre-existing owner-
  attribution behavior, untouched by this change — worth a look if it recurs.
- `sanitizeAreaTags` adds two indexed queries to the task-create path. Measured as
  cheap, but if create latency regresses this is the first thing to look at.
