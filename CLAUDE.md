# CLAUDE.md — krowe-portal

Project-scoped guidance for this repo. The workspace-wide `~/CLAUDE.md` still applies; this file adds rules specific to krowe-portal and takes precedence where they overlap.

## Design System → `DESIGN.md` is LAW

[`DESIGN.md`](./DESIGN.md) is the single source of truth for all visual and interaction design in this platform. Every piece of UI, styling, component, copy, and layout work **must** conform to it. Treat it as binding, not advisory.

**Token source of truth:** the design tokens described in `DESIGN.md` are implemented as CSS custom properties in **`app/globals.css`** (`:root`). This repo has no `src/styles/theme.css` — `app/globals.css` is the file the design values live in.

### Hard rules

- **Never hardcode a value a token exists for.** Use `var(--primary)`, `var(--radius-lg)`, `var(--space-2xl)`, `var(--shadow-2)`, etc. — never a raw `#f97316`, `16px`, or literal shadow when a token covers it.
- **Colors:** only the palettes in `DESIGN.md` (Primary / Neutral / Semantic / Extras). No off-palette hex.
- **Radius:** cards/panels `--radius-lg`, inputs/small cards `--radius-md`, modals `--radius-xl`, pills/avatars/**all buttons** `--radius-full`. Buttons are never rectangular.
- **Motion:** single easing `cubic-bezier(0.16, 1, 0.3, 1)` (`--ease-out-smooth`) for every transition — never `ease-in-out` or `linear`. Animate `transform` and `opacity` only; never `width`/`height`/`margin`/`color`. Always honor `prefers-reduced-motion`.
- **Buttons:** four variants only (Primary / Secondary / Ghost / Destructive). Max one primary action per view (2 buttons max on screen). Focus = 4px orange halo + 1px `--primary` border on every interactive element.
- **Motifs:** Ember Glyph, Blueprint Grid, Sunrise Wash — one motif per section, never all three on a screen, assigned per pattern (see the Patterns section). Don't substitute a pattern's motif.
- **Typography:** use the named scale (Display/H1–H5/Body/Caption/Mono) with the specified family, size, line-height, and tracking. Instrument Serif Italic for Display, Geist for UI/body, Geist Mono for data.
- **Accessibility is part of the design, not optional:** WCAG AA contrast, sequential headings, semantic landmarks, `aria-label` on icon-only buttons, 44×44px min touch targets, real `<label>`s (not placeholder-only), focus trapping in modals.
- **Corner-radius nesting:** `inner-radius = outer-radius − padding` (see the rule + examples in `DESIGN.md`).
- **Voice & tone** in all UI copy: confident, precise, warm — verb-led CTAs that end in an outcome; errors state what happened + what to try. No "Click here"/"Submit", no breathless enthusiasm, no corporate hedging.

### When building or changing UI

1. Read the relevant section of `DESIGN.md` first (Tokens → UI → Patterns → Guidance).
2. Match the existing token/class conventions already in `app/globals.css` and `components/` rather than inventing new ones.
3. If a design need isn't covered by a token or component, **add the token to `app/globals.css` and document it in `DESIGN.md`** — don't one-off a literal value. `DESIGN.md` and `app/globals.css` must stay in sync; when they drift, `DESIGN.md` is the intent and code should be reconciled toward it.
4. Flag any request that would violate this law instead of silently implementing it.
