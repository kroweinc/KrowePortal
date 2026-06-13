# Quote pricing: effort-based (hours × rate), not "always 5 figures"

## Problem
Quote prices are LLM free-guessed dollar amounts, anchored by a prompt rule that
forces "low five figures." They don't reflect real time/scope. Briefs and change
orders already price correctly as `hours × hourlyRate` — quotes were the outlier.

## Decision (user)
- Price each line item as `estimated_hours × hourlyRate`.
- Default rate: **$45/hr** (editable per quote).
- Builder can **toggle** whether hours show on the client-facing document.

## Plan
- [ ] `lib/quote/totals.ts` — add `DEFAULT_QUOTE_HOURLY_RATE = 45`; reprice every
      hour-based line item (`amount = round(hours × rate)`) inside `recomputeTotals`.
      Flat-fee items (no hours) keep their typed amount → backward compatible.
- [ ] `lib/types.ts` — add `hourlyRate?` and `showHours?` to `QuoteContent`.
- [ ] `lib/ai/schemas.ts` — line item gets `hours?`; `amount` defaults to 0;
      content gets `hourlyRate?` + `showHours?`.
- [ ] `lib/ai/generate-quote.ts` — rewrite pricing rules: model estimates honest
      one-builder hours per item (NOT dollars), drop the 5-figure anchor, add an
      effort calibration. Inject default `hourlyRate`. Payment milestones output
      percents.
- [ ] `lib/actions/quote-docs.ts` — after `recomputeTotals`, run
      `applyMilestonePercents` at generation/regeneration so milestone amounts
      derive from the (now hours-based) grand total.
- [ ] `lib/ai/refine-quote-section.ts` — modules refine outputs hours; payments
      refine outputs percents.
- [ ] `components/quote/dashboard/quote-sections.tsx` — line-item hours input +
      computed amount; rate field + "show hours" toggle atop Cost Breakdown.
- [ ] `components/quote/quote-document.tsx` — render an Hours column when
      `showHours` is on.
- [ ] `components/quote/dashboard/quote-stat-strip.tsx` — show total hours @ rate.
- [ ] `components/quote/quote.css` — styles for the hours input / pricing controls.
- [ ] Verify: typecheck + build.

## Review
Done. Quotes now price by effort, identical to how briefs/change-orders already
worked:
- `totals.ts` reprices each hour-based item as `round(hours × rate)`; rate =
  `content.hourlyRate ?? 45`. Flat-fee items (no hours) keep their typed amount,
  so legacy amount-only quotes are untouched.
- AI prompt rewritten: estimates honest one-builder hours (not dollars), 5-figure
  anchor removed, effort calibration added (~20–60h small, 60–150h medium, 150h+
  large). Payments are percents; amounts derived from grand via
  `applyMilestonePercents` at generation.
- Editor: per-line-item hours input + computed cost; rate field + "show hours on
  client quote" toggle atop Cost Breakdown; stat strip shows total hrs @ rate.
- Document: optional Hours column on the client doc, gated by `showHours`.
- No DB migration (content is JSONB; new keys only).
- Verified: `tsc --noEmit` clean.

Net effect: a small 1–2 module MVP (~40h) now quotes ~$1,800 instead of always
landing in five figures.

## Follow-up: recalibrate hours for AI-assisted building
Hours were still hand-coding-era (a basic form came out at 22.5h). Reframed the
prompt calibration around a builder using AI coding agents that one-shot most
straightforward work:
- basic form/page/CRUD screen: ~0.5–1.5h (was effectively a day)
- whole standard CRUD/dashboard module: ~2–6h
- integrations / auth / debugging-heavy work: ~2–8h each (where real hours live)
- whole-project bands cut ~3×: small ~6–20h, medium ~20–60h, large 60h+
- explicit instruction to combine one-shottable items into one pass, not pad each
Applied to both generate-quote.ts and refine-quote-section.ts. Prompt-only
(no type/build impact).
