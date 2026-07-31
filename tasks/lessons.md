# Lessons

Patterns worth not re-learning. Append after any correction from Steven.

## "Context" is ambiguous in this repo — pin the surface before investigating

**2026-07-16.** Asked to "make context load faster", I spent a long research pass
on the Context tab (`/b/engagements/[id]`, `ContextView` / `ContextPanel` /
`getClientGraph`) and proposed a plan for it. The actual target was the `CONTEXT`
chip row at the top of the ⌘K agent hub (`components/agent/agent-console.tsx`).
Nothing in the research transferred.

At least four things in this codebase are called "context":

| "Context" | Where |
|---|---|
| The **Context tab** — graph + list of everything known about a client | `components/context/*`, `/b/engagements/[id]` |
| The **Context Layer** — `context_items` + chunks + embeddings, what RAG reads | `lib/context/*` |
| The agent hub's **CONTEXT chip row** — counts of what the agent can see | `agent-console.tsx`, `getEngagementContextSummary` |
| **Business context** — how the client's business works | `business-context-card.tsx` |

**Rule:** when a request names "context" (or any other overloaded noun here) and
the surface isn't stated, ask *which one* — or ask for a screenshot — BEFORE
opening files. One clarifying question costs a sentence; guessing cost an entire
research pass. A vague noun plus a broad verb ("faster", "cleaner") is a signal
to confirm the target, not to go read code and infer it.

## Measuring for layout: offsetWidth, not getBoundingClientRect()

**2026-07-16.** `<OverflowPills>` measures pills to decide how many fit.
`getBoundingClientRect()` returns **post-transform** dimensions; `clientWidth` /
`offsetWidth` return **layout** dimensions. The command palette opens on a
`transform: scale(0.985)` animation (`krowe-cmd-pop`), so measuring mid-animation
read every pill ~1.5% narrow against an untransformed `clientWidth` — everything
"fit", and the row silently overflowed.

Worse, it never self-corrected: `ResizeObserver` reports untransformed border-box
sizes, so it never fired when the animation ended.

**Rule:** when comparing a measurement against `clientWidth`/`offsetWidth`, measure
with `offsetWidth`. Reserve `getBoundingClientRect()` for actual on-screen
geometry (positioning a popover, hit-testing). Any measure-to-fit component
inside an animated container will hit this.
