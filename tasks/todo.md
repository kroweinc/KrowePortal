# Agent task widgets — "show me my tasks" renders a visual board

## Goal
When the builder asks the ⌘K agent to see/list/review a client's tasks (all, or a
subset by status/priority), the answer renders a compact, read-only **task board**
(status-grouped cards using the existing `krowe-card` design language) instead of a
flat markdown bullet list. Introduces a reusable **widget seam** so the agent can
attach rendered UI to any answer (documents/timeline later).

## Why the current output is flat
`app/api/ai/agent/stream/route.ts` already retrieves structured task rows
(`buildClientContext` → `bundle.tasks`, with real id/status/priority/milestone), but
serializes them to text (`- [status] Title`) for the model, which re-emits them as a
markdown list that `agent-thread.tsx` renders through `ReactMarkdown`. The structured
data is discarded before it reaches the UI. The fix: let the agent return structured
task data as a **widget** the thread renders as cards.

## Design (DESIGN.md is law)
- Compact **read-only** board: sections per status (In progress · To do · Backlog ·
  Done) each with a count; board order = active first, done last.
- Each row: `krowe-prio-dot` priority dot, title link → `/b/tasks/[id]`, `TaskTypeBadge`,
  optional milestone chip. Reuses existing card tokens; new slim `krowe-ah-tw*` classes.
- Tokens only (no raw hex/px). Radius: rows `--radius-md`, container `--radius-lg`.
- Motion: staggered entrance, `transform`/`opacity` only, `--ease-out-smooth`, honors
  `prefers-reduced-motion`. No competing motifs (data surface stays clean).
- Widget never mutates — links navigate to the real task pages where controls live
  (keeps the palette read-focused; no extra primary action).

## Changes

### 1. Types — `lib/agent/types.ts`
- Add `AgentWidget` discriminated union: `{ type: "tasks"; title?; groups: {status, tasks[]}[] }`
  where each task = `{ id, title, priority, type, milestoneTitle? }`.
- `AgentMessage` gains `widgets?: AgentWidget[] | null`.
- `AgentEvent` gains streaming `{ type: "widget"; widget }`; `final` & `proposal` events
  gain `widgets?: AgentWidget[]`.
- `ToolResult` (tools.ts) gains `widget?: AgentWidget`.

### 2. DB migration — `supabase/migrations/0077_agent_message_widgets.sql`
- `alter table agent_messages add column if not exists widgets jsonb;`
- Apply to prod via Supabase Management API + keychain PAT (memory:
  applying-migrations-portal-db), then move file to `migrations/completed/`.

### 3. Store — `lib/agent/store.ts`
- `MessageRow` + `toMessage` + `insertMessage` carry `widgets`.

### 4. New tool `list_tasks` — `lib/agent/tools.ts`
- `kind: "read"`. Params: optional `status` (backlog/todo/in_progress/done/open/all),
  `priority`, `search`.
- Executor queries `tasks` scoped by `engagementId` (same admin+scope pattern as the
  other task tools), selecting `id, title, status, priority, type, milestone(title)`,
  applies filters, builds the grouped widget, returns `{ content: <text summary>, widget }`.
- Register in `TOOLS`.

### 5. Turn engine — `lib/agent/runContextAgent.ts`
- Accumulate `widgets` from read-tool results; yield `{ type: "widget", widget }` as they
  arrive (board paints before the model finishes composing); attach `widgets` to the
  terminal `final`/`proposal` events.

### 6. SSE route — `app/api/ai/agent/stream/route.ts`
- Pass `widget` events through; persist `widgets` on `insertMessage` and include them on
  the sent `final`/`proposal`.

### 7. System prompt — `lib/agent/system-prompt.ts`
- Guidance: for asks to see/list/review tasks (incl. filtered), call `list_tasks` to
  render a board; keep prose to a one-line lead — the board carries the detail.

### 8. UI — `components/agent/task-widget.tsx` (new) + `agent-thread.tsx`
- New `AgentTaskBoard` component renders the grouped board.
- `UIMessage` + `toUIMessages` carry `widgets`; stream handlers set widgets on
  `widget`/`final`/`proposal`; render `<AgentTaskBoard>` in the assistant bubble after
  the prose, near Sources. Reload rehydrates via `getAgentRun` (persisted widgets).

### 9. Styling — `app/globals.css`
- `krowe-ah-tw*` classes (append; note Turbopack sometimes misses appends — restart dev
  server if styles don't hot-reload, per new-task-flow lesson).

## Verification
- Typecheck with `--incremental false` (stale tsbuildinfo memory).
- Drive live on KrowePortal-Context (dev-persist, port 3101) via dev_role=builder:
  open ⌘K → "show me all my tasks" (board renders, grouped, links work) → "show only
  in-progress tasks" (filtered) → reload run (widget persists).

## Review

Implemented 2026-07-16. All 9 steps shipped:

1. **Types** (`lib/agent/types.ts`) — `AgentWidget` discriminated union (`AgentTasksWidget`
   with `groups: {status, tasks[]}[]`, each task `{id, title, priority, type, milestoneTitle?}`);
   `AgentMessage.widgets`; streaming `{type:"widget"}` event; `widgets?` on `final`/`proposal`.
2. **Migration** `0077_agent_message_widgets.sql` — `add column if not exists widgets jsonb`.
   Applied to prod via Supabase Management API + keychain PAT; verified column present; moved
   to `migrations/completed/`.
3. **Store** — `MessageRow`/`toMessage`/`insertMessage` carry `widgets`.
4. **`list_tasks` read tool** — status (backlog/todo/in_progress/done/open/all) + priority +
   search filters, engagement-scoped via admin client, builds the active-first grouped board
   (empty groups dropped), returns a terse count as the model-facing text so it writes a lead
   not a list.
5. **Turn engine** — accumulates widgets from read tools, yields `widget` as they arrive,
   attaches to terminal `final`/`proposal`.
6. **SSE route** — passes `widget` through, persists `widgets`, includes them on `final`/
   `proposal` and the disconnect-persist path.
7. **System prompt** — guidance to call `list_tasks` for see/list/review asks, reply with a
   one-line lead.
8. **UI** — new `components/agent/task-widget.tsx` (`AgentTaskBoard`); `UIMessage`/`toUIMessages`
   carry `widgets`; stream handlers set widgets on `widget`/`final`/`proposal`; board renders
   in the assistant bubble after the prose lead. Works in both hosts (palette + `/b/agent` page)
   since both go through `AgentThread`.
9. **Styling** — `krowe-ah-tw*` classes in `app/globals.css` (tokens only: `--radius-lg`
   container / `--radius-md` rows, staggered `transform`/`opacity` entrance, `--ease-out-smooth`,
   explicit 4px orange focus halo on link rows since the global rule skips `<a>`, honors
   `prefers-reduced-motion`).

**Verification (live, port 3005, dev_role=builder, engagement "Patel Internal"):**
- Typecheck (`tsc --incremental false`) + eslint: clean.
- "show me all my tasks" → model calls `list_tasks`, streams a 3-group board (2 in progress /
   8 backlog / 5 done), prose is a one-line lead. No markdown bullet list.
- "show only in-progress tasks" → board filtered to the single in_progress group (2 tasks).
- Persistence: assistant row stored `widgets` jsonb (1 widget, type "tasks", 3 groups).
- Reload: SSR of `/b/agent/[runId]` rendered the board — container/group heads/19 rows, all
   linking to `/b/tasks/<id>`, priority dots + status labels correct.
- Test run cleaned up from the DB.

---

# Agent search — Direction E: attached search dropdown (minimal view)

## Goal
Replace the builder's minimal agent-chat popover with **Direction E** from the
`Agent Hub.html` design: a compact search dropdown that grows straight out of the
topbar "Search anything" bar — its top row IS the live search field, results sit on
one continuous surface below, an **Ask Krowe about "…"** row hands off to the agent,
and an **Expand** control opens the full-screen search palette.

## Interpretation
- "Minimal view for the agent search" = the non-dimmed dropdown attached to the bar.
- Search-first: live-ranked results as you type (reuse existing `getCommandIndex`
  + `rank`/grouping already in `global-search.tsx` — no parallel engine).
- Agent stays reachable: Ask row / `⌘↵` → full agent hub (AgentConsole, seeded).
- Expand (`⌘↑` / maximize icon) → full-screen dimmed SEARCH palette (existing `.krowe-cmd`).
- Operators: unchanged (keep their existing full modal; no agent).

## Changes
- [x] `app/globals.css` — replaced `.krowe-chatpop*` block with `.krowe-ah-attached*`
      (attached chrome: search row echoing `.krowe-tb-search`, tools, body, ask row).
      Reuses existing `.krowe-cmd-*` row/label/foot classes for the results list. Tokens only.
- [x] `components/global-search.tsx` — renders the attached dropdown in the search wrap
      (builder-only), reusing existing `query`/`groups`/`flatItems`/`selectedIndex`/
      keyboard/`go`/`askAgent` (extracted `renderResults()` shared with the full palette).
      Expand→search-mode full palette, Ask→agent-mode. ⌘K toggle, ⌘↑ expand, ⌘J agent hub,
      Esc + outside-click dismiss.
- [x] Deleted `components/agent/agent-chat.tsx` (replaced; only GlobalSearch used it).

## Verify
- [x] Dev server (:3005), Playwright as builder: dropdown flush under bar (x:288 y:12 =
      bar's edge, `position:absolute`, height-capped w/ scroll); typed → grouped results +
      Ask row; Expand button & ⌘↑ → full search carrying the query; Ask row → agent console;
      Esc + outside-click dismiss. Operator ⌘K → full modal, no dropdown. tsc + eslint clean.

## Review
Direction E is now the builder's minimal search surface. Faithful to the design's peek
(search-first dropdown that grows out of the bar, ember-marked Ask row, expand affordance)
while reusing the repo's existing index/ranking/keyboard machinery rather than a parallel
engine. No new tokens (all existing `--primary/--border-strong/--radius-lg/--shadow-3/…`).
Hit the known Turbopack stale-`globals.css` miss mid-build — a real content change to
globals.css (not `touch app/layout.tsx`) was needed to recompile; verified via served-CSS grep.
Operators unchanged (no agent); full palette's Ask still sits top (dirs A/D pattern) — out of scope.
