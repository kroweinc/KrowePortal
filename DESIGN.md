# Krowe Design System

> Single source of truth for tokens, components, patterns, and guidance. All values derive from `app/globals.css`.

---

## Table of Contents

1. [Tokens](#tokens)
   - [Colors](#colors)
   - [Typography](#typography)
   - [Animation](#animation)
   - [Space & Elevation](#space--elevation)
   - [Motifs](#motifs)
2. [UI](#ui)
   - [Buttons](#buttons)
   - [Cards](#cards)
   - [Components](#components)
3. [Patterns](#patterns)
4. [Guidance](#guidance)
   - [Voice & Tone](#voice--tone)
   - [Accessibility](#accessibility)
   - [Corner Radius & Padding](#corner-radius--padding)

---

## Tokens

### Colors

#### Primary Palette

| Token | Hex | OKLCH | Usage |
|---|---|---|---|
| `--primary` | `#f97316` | `oklch(70% 0.17 40)` | CTAs, active states, links |
| `--primary-hover` | `#ea580c` | `oklch(63% 0.18 40)` | Hover state for primary |
| `--primary-soft` | `#ffedd5` | `oklch(95% 0.05 60)` | Tinted backgrounds, chips |
| `--primary-accent` | `#ff6a4d` | `oklch(72% 0.19 27)` | Gradient accent, EmberGlyph fill |

#### Neutral Palette

| Token | Hex | Usage |
|---|---|---|
| `--background` | `#fdfbfa` | Page canvas |
| `--surface-subtle` | `#fbf8f5` | Card / panel backgrounds |
| `--foreground` | `#1a1512` | Body text, icons |
| `--muted-foreground` | `#68625e` | Secondary text, placeholders |
| `--border` | `#e7e4e1` | Dividers, input borders |

#### Semantic Palette

| Token | Hex | Light Variant | Usage |
|---|---|---|---|
| `--success` | `#15803d` | `--success-light: #f0fdf4` | Confirmations |
| `--warning` | `#b45309` | `--warning-light: #fffbeb` | Caution states |
| `--danger` | `#b91c1c` | `--danger-light: #fef2f2` | Errors, destructive actions |

#### Extras

| Token | Value | Usage |
|---|---|---|
| `--callout-bg` | `#fef5ed` | Informational callout fill |
| `--callout-border` | `#edcfb9` | Informational callout stroke |
| `--gradient-primary` | `linear-gradient(135deg, #f97316 0%, #ff6a4d 100%)` | Hero accents, EmberGlyph backgrounds |

---

### Typography

**Typefaces**

| Role | Family | Notes |
|---|---|---|
| Display / Editorial | Instrument Serif | Italic weight for hero headlines |
| UI / Body | Geist | 400 Regular + 600 SemiBold |
| Code / Mono | Geist Mono | Data, timestamps, IDs |

**Scale**

| Name | Size | Line Height | Letter Spacing | Weight | Family |
|---|---|---|---|---|---|
| Display XL | 80px | 1.10 | −3px | 400 Italic | Instrument Serif |
| Display L | 56px | 1.15 | −1.12px | 400 Italic | Instrument Serif |
| Display M | 36px | 1.25 | −0.54px | 400 Italic | Instrument Serif |
| H1 | 30px | 1.30 | −0.3px | 600 | Geist |
| H2 | 24px | 1.35 | −0.2px | 600 | Geist |
| H3 | 20px | 1.40 | −0.1px | 600 | Geist |
| H4 | 16px | 1.45 | 0px | 600 | Geist |
| H5 | 14px | 1.50 | 0.1px | 600 | Geist |
| Body L | 18px | 1.65 | 0px | 400 | Geist |
| Body M | 16px | 1.65 | 0px | 400 | Geist |
| Body S | 14px | 1.65 | 0.1px | 400 | Geist |
| Caption | 12px | 1.50 | 0.2px | 400 | Geist |
| Caption Strong | 12px | 1.50 | 0.2px | 600 | Geist |
| Mono | 12px | 1.60 | 0px | 400 | Geist Mono |

---

### Animation

#### Duration Tokens

| Token | Value | Usage |
|---|---|---|
| `--duration-fast` | `100ms` | Micro-interactions (checkbox, toggle) |
| `--duration-normal` | `200ms` | Hover transitions, tooltips |
| `--duration-slow` | `350ms` | Panel slides, dropdowns |
| `--duration-slower` | `500ms` | Page-level entrances |
| `--duration-slowest` | `850ms` | Hero sequences |

#### Easing

Single system easing: `cubic-bezier(0.16, 1, 0.3, 1)`

This spring-like curve decelerates quickly after an initial burst — use it for every transition. Never use `ease-in-out` or `linear` for UI motion.

#### Entrance Patterns

**Headline clip (Display + H1 on marketing pages)**
```css
@keyframes clip-in {
  from { clip-path: inset(0 100% 0 0); }
  to   { clip-path: inset(0 0% 0 0); }
}
```
Duration: `--duration-slowest`. Trigger: page load or section scroll-into-view.

**Staggered question list (onboarding)**
Each question card fades up `(translateY 16px → 0, opacity 0 → 1)`.
Stagger offset: `80ms` per item. Duration per item: `--duration-slower`.

**Supporting line fade**
Subtitle text beneath a hero headline fades in at `--duration-slower` with a `200ms` delay after the headline clip completes.

**Global rule:** Animate `transform` and `opacity` only. Never animate `width`, `height`, `margin`, or `color` directly — use pseudo-element overlays or CSS variable transitions instead.

---

### Space & Elevation

#### Spacing Scale (4pt grid)

| Token | Value |
|---|---|
| `--space-xs` | `2px` |
| `--space-sm` | `4px` |
| `--space-md` | `8px` |
| `--space-lg` | `12px` |
| `--space-xl` | `16px` |
| `--space-2xl` | `24px` |
| `--space-3xl` | `32px` |
| `--space-4xl` | `48px` |
| `--space-5xl` | `64px` |
| `--space-6xl` | `96px` |

#### Border Radius

| Token | Value | Usage |
|---|---|---|
| `--radius-sm` | `6px` | Tags, badges, tooltips |
| `--radius-md` | `10px` | Inputs, small cards |
| `--radius-lg` | `16px` | Cards, panels |
| `--radius-xl` | `24px` | Modals, large surfaces |
| `--radius-full` | `9999px` | Pills, avatars, buttons |

#### Elevation (Shadows)

All shadows carry 8% orange warmth (`rgba(249, 115, 22, 0.08)`) baked in.

| Token | Value |
|---|---|
| `--shadow-1` | `0 1px 2px rgba(249,115,22,0.04), 0 1px 4px rgba(0,0,0,0.06)` |
| `--shadow-2` | `0 2px 8px rgba(249,115,22,0.06), 0 4px 16px rgba(0,0,0,0.08)` |
| `--shadow-3` | `0 4px 16px rgba(249,115,22,0.08), 0 8px 32px rgba(0,0,0,0.10)` |
| `--shadow-4` | `0 8px 32px rgba(249,115,22,0.10), 0 16px 64px rgba(0,0,0,0.12)` |

**Button glow recipe (primary button active/hover)**
```css
box-shadow:
  0 0 0 4px rgba(249, 115, 22, 0.10),
  0 2px 8px rgba(249, 115, 22, 0.20);
```

---

### Motifs

Three decorative elements give Krowe its visual identity. Use each in its designated context — never mix all three on a single screen.

#### Ember Glyph

```jsx
<EmberGlyph size={24} />  // sizes: 12 | 16 | 24 | 48
```

- **Fill:** `--primary-accent` (`#ff6a4d`) or white when on dark/orange backgrounds
- **Opacity:** 100% when used as a standalone accent; 20–40% when tiled or layered
- **Do:** Place in hero sections as a single large glyph (48px), or use 12px variants in UI chips and badges
- **Don't:** Animate the glyph itself — surrounding elements may animate, but the glyph stays static
- **Don't:** Use more than one size on a single component; pick one and be consistent

#### Blueprint Grid

```css
background-image: var(--blueprint-grid);
/* --blueprint-grid = repeating-linear-gradient lines at 20px intervals */
```

- **Opacity:** 20–30% over page backgrounds; never above 40%
- **Do:** Use as a full-bleed section background on auth, onboarding, and dashboard containers
- **Do:** Pair with a white or `--surface-subtle` card layered on top for contrast
- **Don't:** Show the grid beneath dark-background sections — it vanishes and adds noise
- **Don't:** Use the grid inside cards; it belongs to the page layer, not the component layer

#### Sunrise Wash

5-stop gradient applied as a full-bleed section fill or as a `::before` pseudo-element:

```css
background: linear-gradient(
  180deg,
  #fff9f5 0%,
  #ffedd5 25%,
  #fed7aa 50%,
  #fdba74 75%,
  #fdfbfa 100%
);
```

- **Do:** Use on marketing hero sections and empty-state backgrounds to add warmth
- **Do:** Fade the wash out with a white overlay at the bottom so it transitions cleanly into the page background
- **Don't:** Use Sunrise Wash and Blueprint Grid on the same section — pick one
- **Don't:** Apply the wash to small surfaces (cards, inputs) — it reads as a mistake at small scale

---

## UI

### Buttons

#### Variants

| Variant | Background | Text | Border | Usage |
|---|---|---|---|---|
| Primary | `--primary` | White | None | Single primary action per view |
| Secondary | `--surface-subtle` | `--foreground` | `--border` | Secondary actions alongside primary |
| Ghost | Transparent | `--primary` | None | Tertiary actions, icon-only buttons |
| Destructive | `--danger` | White | None | Irreversible actions (delete, revoke) |

Use primary buttons for main actions such as submitting - no more than 2 in one screen.
Use secondary buttons for smaller actions that don't need to bring too much attention to themselves, such as saving a draft.
Use ghost buttons for tertiary actions that don't need icons.
Use destructive buttons sparingly when there is an option to delete something significant.

#### Sizes

| Size | Font | Padding (V × H) | Height |
|---|---|---|---|
| Small | 14px / 600 | 6px × 16px | 32px |
| Medium | 16px / 600 | 8px × 20px | 40px |
| Large | 20px / 600 | 10px × 24px | 48px |

#### Shape

All buttons use `--radius-full` (pill). Never use a rectangular button.

#### Focus Ring

```css
outline: none;
box-shadow: 0 0 0 4px rgba(249, 115, 22, 0.10);
border: 1px solid var(--primary);
```

The 4px orange halo is the system's universal keyboard-focus signal.

#### States

```
default → hover (darken 8%) → active (scale 0.97) → focus (ring) → disabled (40% opacity, no pointer)
```

Transition: `all var(--duration-normal) cubic-bezier(0.16, 1, 0.3, 1)`

---

### Cards

#### Selection Card

Used in onboarding question flows where the user picks from a grid of options.

| Property | Value |
|---|---|
| Size | 214 × 214 px |
| Radius | `--radius-lg` (16px) |
| Background | `--surface-subtle` |
| Border (default) | 1px `--border` |
| Shadow (default) | `--shadow-1` |
| Shadow (hover) | `--shadow-2` |
| Border (selected) | 2px `--primary` |
| Checkmark (selected) | 20px circle, `--primary` fill, top-right corner |
| Transition | `box-shadow`, `border-color` at `--duration-normal` |

Content layout: centered icon (48px) + label (Body M, `--foreground`) stacked vertically with `--space-lg` gap.
The variants are selected, unselected, and null.

#### Verdict Card

Displayed on the report/results screen to communicate the AI's recommendation.

| Property | Value |
|---|---|
| Width | Full-width within container (max 720px) |
| Radius | `--radius-xl` (24px) |
| Background | White |
| Shadow | `--shadow-3` |
| Padding | `--space-4xl` (48px) |

Ensure that the user has actions to take upon seeing this card.

**Internal structure (top to bottom):**

1. Semantic badge — pill label in one of three states:
   - **Proceed** → `--success-light` background, `--success` text
   - **Pivot** → `--warning-light` background, `--warning` text
   - **Rethink** → `--danger-light` background, `--danger` text
2. Verdict headline — Display L (56px) Instrument Serif Italic
3. Summary body — Body L (18px) Geist, `--muted-foreground`
4. Divider — 1px `--border`
5. Action buttons — Primary + Ghost pair, right-aligned

---

### Components

#### Form Inputs

Show green for acceptable input and red for inacceptable. Gray is default.

| Property | Value |
|---|---|
| Height | 40px (medium), 32px (small) |
| Radius | `--radius-md` (10px) |
| Border | 1px `--border` |
| Background | White |
| Padding | 0 `--space-xl` |
| Font | Body M (16px), `--foreground` |
| Placeholder | Body M, `--muted-foreground` |
| Focus border | `--primary` |
| Focus ring | 4px `rgba(249,115,22,0.10)` |
| Error border | `--danger` |
| Error ring | 4px `rgba(185,28,28,0.10)` |

#### Progress Stepper

Used in onboarding to show completion progress across question sets.

- Track: 4px height, `--border` color, `--radius-full`
- Fill: `--primary` color, animates width with `--duration-slow`
- Step dots: 8px circles; completed = `--primary` fill, active = white fill + `--primary` border, upcoming = `--border` fill
- Label (optional): Caption, `--muted-foreground`, centered below track

#### AI Interaction Panel

Two states: **empty** and **rewrite**.

**Empty state**
- Background: `--surface-subtle`
- Border: 1px dashed `--border`
- Radius: `--radius-lg`
- Content: EmberGlyph 24px (centered) + "Your analysis will appear here" (Body M, `--muted-foreground`)
- Padding: `--space-4xl`

**Rewrite state**
- Background: White
- Border: 1px `--border`
- Shadow: `--shadow-2`
- Header row: AI label (Caption Strong) + Rewrite button (Ghost, Small)
- Body: scrollable Body M text, max-height 320px
- Footer: copy/share action row (Ghost buttons)

#### Empty & Error Shells

Full-section states that replace primary content when data is absent or broken.

**Error shell**
- Background: `--danger-light`
- Border: 1px `--danger` at 30% opacity
- Icon: 24px warning icon, `--danger`
- Heading: H3, `--danger`
- Body: Body M, `--muted-foreground`
- Action: Secondary button ("Try again")

**Warning shell**
- Background: `--warning-light`
- Border: 1px `--warning` at 30% opacity
- Icon: 24px info icon, `--warning`
- Heading: H3, `--warning`
- Body: Body M, `--muted-foreground`
- Action: Secondary button

---

## Patterns

Each screen pattern names its motif, layout structure, and key component composition. Motifs are assigned per pattern — do not substitute.

### Marketing Landing

**Motif:** Sunrise Wash (hero section) + EmberGlyph 48px (hero accent)

**Layout:**
- Full-bleed hero with Sunrise Wash background, max-height 640px
- Headline: Display XL Instrument Serif Italic, centered
- Subhead: Body L `--muted-foreground`, centered, 480px max-width
- CTA pair: Primary (large) + Ghost (large), horizontally stacked with `--space-lg` gap
- Below the fold: content sections on `--background`, Blueprint Grid optional at 20% opacity

**Component composition:**
Nav → Hero (Sunrise Wash + EmberGlyph) → Feature grid (3-column) → Social proof row → CTA banner → Footer

---

### Auth Split

**Motif:** Blueprint Grid (left panel only)

**Layout:**
- 50/50 horizontal split on desktop; single column on mobile (form on top)
- Left panel: `--surface-subtle` + Blueprint Grid at 25% opacity, brand mark centered
- Right panel: White, vertically centered form (max-width 400px)
- Form: Email + Password inputs, Primary button (full-width), divider, OAuth options

**Component composition:**
Left (brand) panel → Right (form) panel → Input fields → Primary button → Error shell (inline, below submit)

---

### Onboarding

**Motif:** None (keep the screen clean; the question cards are the visual focus)

**Layout:**
- Single-column centered (max-width 640px)
- Progress Stepper pinned below the top nav
- One question per screen: Display M headline + supporting Body M subhead
- Answer grid: 2×2 or 2×3 Selection Cards with `--space-2xl` gap
- Navigation: "Back" (Ghost) + "Continue" (Primary) pair, bottom-right aligned

**Entrance animation:** Staggered question cards fade up (80ms stagger, `--duration-slower` per card).

**Component composition:**
Progress Stepper → Question headline → Selection Card grid → Navigation buttons

---

### Dashboard

**Motif:** Blueprint Grid (page background, 20% opacity)

**Layout:**
- Sidebar nav (240px fixed) + main content area
- Main: 12-column grid; stat cards span 3 cols, content panels span 6 or 12
- Stat cards: `--surface-subtle` bg, `--shadow-1`, H2 metric + Caption label
- AI Interaction Panel occupies a full-width slot in the content area

**Component composition:**
Sidebar → Top bar (breadcrumb + user avatar) → Stat card row → Content panels → AI Interaction Panel

---

### Report / Verdict

**Motif:** Sunrise Wash (full-bleed section behind the Verdict Card)

**Layout:**
- Single-column centered (max-width 720px)
- Sunrise Wash fills the viewport height for the verdict section
- Verdict Card floats centered over the wash with `--shadow-3`
- Below: expandable detail sections (accordion pattern) on `--background`

**Component composition:**
Verdict Card (Proceed/Pivot/Rethink badge + Display L headline + action buttons) → Detail accordion → Share / Export actions

---

### Ideas Browse

**Motif:** EmberGlyph 12px as a decorative bullet in list items

**Layout:**
- Two-column layout: filter sidebar (280px) + results grid
- Results: masonry or 3-column card grid
- Each idea card: `--radius-lg`, `--shadow-1`, image or gradient thumbnail + H4 title + Body S excerpt + tag row
- Filter sidebar: grouped checkboxes, range sliders, "Clear all" Ghost button at top

**Component composition:**
Filter sidebar → Sort bar → Idea card grid → Pagination or infinite scroll trigger → Empty shell (when no results)

---

## Guidance

### Voice & Tone

**Tone:** Confident, precise, never breathless. Krowe speaks like a trusted advisor — direct but warm. Avoid extreme enthusiasm ("Amazing!", "Super easy!") and corporate hedging ("leverage", "synergize") to come off warm and honest, like a senior friend.

**Cadence:** Short sentences in UI copy. Long-form content (reports, explanations) may use longer sentences, but each paragraph must have one clear point.

**Honesty:** When uncertain, say so directly using: (Maybe/worth/not yet)
- "This might be worth exploring..."
- "Worth considering..."
- "Not yet clear, but..."

**CTAs:** Lead with a verb, end with an outcome.
- Good: "Analyze my idea", "See your report", "Start building"
- Avoid: "Click here", "Submit", "Next"

**Errors:** State what happened, then what to try. (Provide a solution)
- Good: "We couldn't load your report. Check your connection and try again."
- Avoid: "An error occurred. Please try again later."

---

### Accessibility

#### Contrast
- Body text: WCAG AA minimum (4.5:1 ratio)
- Large text / UI components: WCAG AA large (3:1 ratio)
- Use `--foreground` (#1a1512) on `--background` (#fdfbfa): passes AA at all sizes
- Never place `--muted-foreground` text on `--surface-subtle` without checking contrast

#### Focus & Keyboard
Primary focus treatment in components uses the orange ring at controlled opacity. Tab order should follow reading order; modals must trap focus until dismissed.
- Focus ring: 4px `rgba(249,115,22,0.10)` halo + 1px `--primary` border — present on every interactive element
- Tab order: follows DOM order; never use positive `tabindex` values
- Modals: trap focus within the modal while open; return focus to the trigger on close
- Icon-only buttons: always include `aria-label`
- Disclosure patterns: use `aria-expanded` + `aria-controls`

#### Touch Targets
- Minimum size: 44 × 44 px for all interactive elements
- Keep spacing between adjacent tappable items so they are easy to hit on phones
- If the visual element is smaller (e.g., a 16px icon button), expand the tap area via padding or `::after` pseudo-element

#### Motion
- Respect `prefers-reduced-motion`:
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }
  ```
- Only animate `transform` and `opacity` — these are GPU-composited and do not cause layout or paint
- Avoid other animations
- Never auto-play looping animations without a pause control

#### Content Structure
- Use semantic HTML landmarks (`<header>`, `<main>`, `<nav>`, `<aside>`, `<footer>`)
- Heading levels must be sequential — never skip from H1 to H3
- Images: meaningful images need `alt` text; decorative images use `alt=""`
- Form inputs: every input must have an associated `<label>` (not just a placeholder)

---

### Corner Radius & Padding

**Rule:** `inner-radius = outer-radius − padding`

When a card (outer element) uses `--radius-lg` (16px) with `--space-2xl` (24px) padding, the inner element should use a radius of at most `16 − 24 = negative` — meaning inner elements flush to or without radius. When padding is smaller than the outer radius, apply: `inner-radius = outer-radius − padding`.

**Example:**

```
Outer card:     radius-lg (16px),  padding 8px
└─ Inner image: radius = 16 − 8 = 8px  ✓

Outer card:     radius-lg (16px),  padding 4px
└─ Inner chip:  radius = 16 − 4 = 12px ✓

Outer modal:    radius-xl (24px),  padding 24px
└─ Inner input: radius-md (10px)   ✓ (padding ≥ outer radius, use standard component radius)
```

When outer padding equals or exceeds the outer radius, inner elements may use their own standard radii freely. (all its branches too)
