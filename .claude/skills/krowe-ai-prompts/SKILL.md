---
name: krowe-ai-prompts
description: >
  Author or edit any prompt sent to an LLM in KrowePortal — system prompts, user
  prompts, tool-loop prompts, or the `build*SystemPrompt` / `build*UserPrompt`
  functions in `lib/ai/prompts.ts`. Use whenever adding a new `lib/ai/*` generator,
  changing prompt text, adding a field to a zod schema in `lib/ai/schemas.ts`,
  debugging bad/empty/hallucinated model output, or wiring a new AI feature.
  Trigger on "write a prompt", "the AI returns garbage", "add an AI feature",
  "prompt isn't following instructions", "model ignores the rule", "add a field to
  the PRD/task/quote schema". Encodes what is verified true for `gpt-5.4-mini` as
  this repo configures it — most public prompt advice is written for Claude or for
  non-reasoning models and is wrong here.
---

# KrowePortal prompt authoring

Every prompt in this repo goes to **`gpt-5.4-mini` at `reasoning_effort: "low"`**
(`lib/ai/client.ts`). That single fact invalidates most prompt advice you'll find
online. Read "Model reality" before porting any technique from a blog post.

For latency, streaming, caching, and effort routing → the `fast-ai-calls` skill.
This skill owns **what the prompt says**, not how fast it returns.

---

## The house pattern — follow it

Prompts live in `lib/ai/prompts.ts` as paired builder functions. Generators live
in `lib/ai/<verb>-<noun>.ts`. Never inline a prompt string at a call site.

```ts
// lib/ai/prompts.ts
export function buildThingSystemPrompt(): string { /* static rules */ }
export function buildThingUserPrompt(input: X): string { /* dynamic data only */ }
```

```ts
// lib/ai/generate-thing.ts
const response = await runChat({
  model: AI_MODEL,
  max_completion_tokens: 400,
  response_format: jsonResponseFormat(ThingResult, "thing_result"),
  messages: [
    { role: "system", content: buildThingSystemPrompt() },
    { role: "user", content: buildThingUserPrompt(input) },
  ],
}, meta);
```

Then parse defensively and resample **once** before throwing — see
`classify-task.ts` for the canonical shape. A stray first sample self-corrects;
a second failure is real.

Pass `meta` so the call lands in the `ai_usage` ledger. An unmetered call is a
bug.

### System prompt section order

House convention, applied consistently. **Be honest about why:** nobody has
published a controlled experiment on section ordering — every public ordering
claim is really a caching or long-context claim. This order is for *our*
consistency and diffability, not because it benchmarks better.

1. Role + task, one sentence.
2. Context / what the model does and doesn't have access to.
3. Rubric or reference points, if the task needs calibration.
4. `Rules:` — the constraints.
5. Off-schema behavior (see below — mandatory).

Dynamic data goes in the **user** prompt. The system prompt should be a pure
function of nothing, or of stable config.

---

## Model reality — `gpt-5.4-mini` @ `reasoning_effort: "low"`

Verified against the live API on 2026-07-15. Re-probe before trusting any of it
after a model bump.

| Fact | Consequence |
|---|---|
| `temperature` / `top_p` / `logprobs` **400 at effort ≥ `low`** | Never pass them. Only legal at effort `none`. The workspace CLAUDE.md rule is correct **because** we run `low`. |
| `reasoning_effort: "minimal"` is **rejected** — valid values are `none`, `low`, `medium`, `high`, `xhigh` | `minimal` was a GPT-5.0 value. ⚠️ `client.ts` still lists it in `ReasoningEffort` + `REASONING_EFFORTS`; setting `OPENAI_REASONING_EFFORT=minimal` passes our validation and 400s every AI call. |
| `gpt-5.4-mini` is **more literal and makes fewer assumptions** than big models | OpenAI's own small-model guidance: prompts here are *longer and more explicit*, not shorter. Don't "trust the model to infer." |
| Determinism comes from Structured Outputs, not `temperature` | We already use strict schemas. That *is* the determinism lever. |
| Higher effort makes schema-hallucination **worse**, not better | At `high` the model burns reasoning finding a way to fill a field it should have left null. Don't raise effort to fix a bad output contract. |

**`gpt-5.4-mini` prompting rules** (OpenAI's small-model guidance):
- Critical rules first.
- Don't rely on "you MUST" alone — use numbered steps and explicit decision rules.
- Define ambiguity behavior explicitly: when to ask, abstain, or proceed.
- Prefer `after the final JSON, output nothing further` over a bare
  `output nothing else`.

---

## Non-negotiables

### 1. Derive every enumeration from the type — never hand-list

This is the best pattern in the codebase. Keep it.

```ts
const TASK_TAG_DESCRIPTIONS: Record<TaskTag, string> = { ui: "...", backend: "..." };
const labelList = TASK_TAGS.map((t) => `- "${t}": ${TASK_TAG_DESCRIPTIONS[t]}`).join("\n");
```

Adding a tag to `TASK_TAGS` becomes a **compile error** until the prompt is
updated. Prompt text and schema cannot drift. It has no industry name; BAML's
`{{ ctx.output_format }}` is the only public tool that argues the same principle.

Never write a literal list of enum values into a prompt string. If you're typing
`"one of: feature | bug | change"` by hand, derive it instead.

### 2. State every constraint in prompt text — the wire schema won't carry it

`strict-schema.ts` strips `minLength`, `maxLength`, `minItems`, `maxItems`,
`pattern`, `format`, … from the wire schema. **Zod still enforces all ~145 of
them at `safeParse`.** A constraint you don't state in the prompt is a silent
resample, then a thrown error.

The existing comments say OpenAI "can't enforce" these. **That is factually
wrong** — verified: `maxItems: 1` and `maxLength: 5` *are* enforced by
constrained decoding. Keep the stripping anyway, for the real reason:

> Grammar-enforced constraints don't produce a *good* answer, they produce a
> schema-valid mutilated one, silently. `maxLength: 5` on a 50-word note returns
> `"Auth,"`. A `minItems` the prompt contradicts can collapse the decoder into a
> token-burning garbage loop until `max_completion_tokens`.

So: **the prompt aims, zod gates, a miss is loud.** That's the trade. Don't
"fix" it by unstripping keywords.

Practical rule — if a zod field says `.max(80)`, the prompt says `≤80 chars`.

### 3. Every extraction prompt needs an off-schema clause

The single highest-ROI, fully-documented change. OpenAI, verbatim:

> The model will always try to adhere to the provided schema, which can result in
> hallucinations if the input is completely unrelated to the schema.

Verified: asked "What is the capital of France?" against a schema with a field
described as a person's legal name, the model returned `{"name": "Paris"}`.

Always include something like:

> If the input does not contain a value for a field, return null for that field.
> Do not substitute a related fact from the input.

### 4. Don't restate the schema in the prompt

Strict mode **guarantees** shape, key presence, key order, types, and enum
membership. Restating them costs tokens and can only lose — and any drift between
the prose and the real schema is a contradiction, which hurts GPT-5 *more* than
other models (below).

The prompt carries **semantics and constraints**, never the field list.

⚠️ Existing prompts end with:

```
Output format — respond ONLY with valid JSON in this exact shape:
{"hoursLow": 0.25, "hoursHigh": 0.75}
No markdown, no explanation, no wrapper — raw JSON only.
```

Under `jsonResponseFormat(...)` this is dead weight, and `"No markdown"` is
token-level negation (§5). It's harmless enough to leave in prompts that work —
**don't do a sweep** — but don't copy it into new ones. Exception: the
`runWithTools` path in `generate-subtasks.ts` falls back to `json_object`, which
has no grammar. There the format instruction is load-bearing. Keep it.

---

## Writing the rules

### 5. Negation: replace at the token level, forbid at the action level

Evidence-backed (multiple independent papers + mechanistic work): `"don't use
markdown"` *primes* markdown. Models boost the probability of the token you
forbade.

- **Style/token level** → state the positive. Not `"no markdown"` → `"raw JSON
  only"` (which we already do — that's the good half of that block).
- **Action/scope level** → forbidding is fine. `"NEVER invent your own label"`
  works; there's no token to leak and there's a positive default to fall back on.

**Always attach the reason.** `"NEVER X because Y"` beats `"NEVER X"` — the model
generalizes from Y to cases your rule didn't enumerate. Our classify prompt does
this well: it lists forbidden invented labels *with examples* of what not to
invent.

### 6. Rule lists are correct here — but audit them for contradictions

Do **not** import Anthropic's "delete your rules, write principles" advice. That
guidance is tuned for Claude, which generalizes from principle. OpenAI's GPT-5.x
line is tuned for **literal adherence**, and the GPT-5.2 guide explicitly pushes
explicit constraints over open-ended judgment. Our `Rules:` blocks belong.

The cost: OpenAI states that *"poorly-constructed prompts containing contradictory
or vague instructions can be more damaging to GPT-5 than to other models."* Long
rule lists manufacture contradictions, and better instruction-following punishes
you harder for them.

**So when a prompt misbehaves, audit before adding a rule.** Paste the system
prompt to the model and ask it to quote the lines most likely causing the
behavior, including any contradictions. Then make small explicit edits — clarify
the conflict, delete the redundant line. Adding a rule to fight a rule is how
prompts rot.

The worst case is a rule that contradicts a *schema* constraint. Prompt says "name
exactly one color", schema says `minItems: 5` → the decoder cannot satisfy both
and degenerates. Check new rules against the zod schema, not just against the
other rules.

### 7. "Think step by step" — depends on effort, don't cargo-cult either way

- At effort ≥ `low` (**us**): redundant. The model reasons internally. Don't add it.
- At effort `none`: OpenAI *recommends* it — there's no internal reasoning to rely on.

If anyone ever sets `OPENAI_REASONING_EFFORT=none`, prompts need step-outlining
added back. The rule inverts; it isn't universal.

The real anti-pattern is asking for more reasoning instead of a better contract.
Replace `"think harder"` with an explicit verification step.

### 8. Few-shot examples are a format tool, not a reasoning tool

On current models, examples align output *shape*; they don't improve reasoning and
can constrain it. Under strict mode the shape is already guaranteed — so most
examples here are redundant.

Use an example only when the *semantics* are hard to describe in words (the
estimate prompt's hour-range reference points are a good use: they calibrate
judgment, not format). Keep them **canonical**, not edge cases. Edge cases go in
tests, not the prompt.

---

## Before you ship

1. **Does the prompt state every zod constraint?** Grep the schema for `.min(`,
   `.max(`, `.length(`. Each one needs prompt text or it's a silent resample.
2. **Does it have an off-schema clause?** If it extracts from user input, yes.
3. **Any new rule contradict an existing rule or the schema?** Ask the model.
4. **No `temperature`.** No `minimal`. Dynamic data in the *user* prompt.
5. **`meta` passed to `runChat`?**
6. **Snapshot the rendered prompt.** Highest-ROI test available, free, no API call:

   ```ts
   import { expect, test } from "vitest";
   import { buildClassifyTaskSystemPrompt } from "@/lib/ai/prompts";
   test("classify system prompt", async () => {
     await expect(buildClassifyTaskSystemPrompt())
       .toMatchFileSnapshot("./__snapshots__/classify-system.md");
   });
   ```

   Every prompt change becomes a legible PR diff. This is most of what teams buy
   prompt-management SaaS to get. Requires the builder be deterministic — never
   interpolate `new Date()` into a prompt.

7. **Read ~20 real outputs yourself** when changing a prompt that matters. Per
   Husain/Shankar, that beats any metric you could add. Build an automated eval
   only for a failure that *survives* prompt fixes — an LLM judge costs 100+
   labeled examples and ongoing maintenance. Don't start there.

---

## Sources

Provider docs (verify after any model bump — the model-specific pages move fast):
- [GPT-5.4 guide](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.4) — effort defaults, param compatibility, **small-model guidance for `gpt-5.4-mini`**
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) — supported schemas, off-schema hallucination warning, refusals
- [GPT-5 prompting guide](https://cookbook.openai.com/examples/gpt-5/gpt-5_prompting_guide) — contradictory-instruction damage, eagerness
- [Reasoning best practices](https://developers.openai.com/api/docs/guides/reasoning-best-practices) — avoid CoT at effort ≥ low

Evidence:
- [Negation: A Pink Elephant in the LLMs' Room?](https://arxiv.org/html/2503.22395v1) — negative imperatives boost undesired tokens
- [Revisiting CoT Prompting](https://arxiv.org/html/2506.14641v1) — few-shot aligns format, not reasoning
- [Hamel Husain — LLM Evals FAQ](https://hamel.dev/blog/posts/evals-faq/) — 20–50 outputs; anti-premature-automation
- [Prompt management in GitHub repos](https://arxiv.org/html/2509.12421v2) — duplication is the #1 measured anti-pattern (10.1% exact, 38.5% semantic)

Not applicable here, don't import: Anthropic's prompting guidance (XML tags,
"write principles not rules", "delete prescriptive instructions"). It's correct
for Claude and wrong for `gpt-5.4-mini`. **Prompts do not port across providers.**
