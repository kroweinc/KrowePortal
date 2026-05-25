import type { RepoContext } from "@/lib/github/types";
import type { Task, TaskAttachment } from "@/lib/types";

const MANIFEST_PROMPT_CAP = 150;

const TOOL_GUIDANCE = `You have tools to read this repo's codebase: list_directory(path), read_file(path), and search_code(query). You MUST investigate before deciding whether to return a final answer or ask the user clarifying questions — investigation always comes first, even if the description seems clear.

Phase 1 — Investigate (required, before any output):
1. Read the dependency manifest for the language(s) listed above (e.g. "package.json" for JS/TS, "pyproject.toml" or "requirements.txt" for Python, "go.mod" for Go, "Cargo.toml" for Rust, "Gemfile" for Ruby, "composer.json" for PHP). This tells you the actual frameworks, UI libraries, ORM, router, CSS system, build tool, and test runner — do not guess.
2. list_directory the folder the task most likely touches (e.g. "components", "app", "src", "lib") and any folder the user named.
3. search_code or read_file to locate the feature, component, route, table, or data shape the user mentioned. If they referred to "the list" / "the table" / "the form" / "the page" / "the X view", find which file actually owns it.

Phase 2 — Decide:
- If your investigation answered the open questions, return the final task/subtasks JSON, grounded in the file paths and patterns you actually saw.
- Only ask the user clarifying questions about gaps that genuinely survived investigation (product decisions, ambiguous intent, choices the codebase cannot answer).
- Do not stop investigating prematurely. Keep calling tools until you either have enough context or have proven the gap is a real product question for the user.`;

const ESTIMATE_RULES = `- For EACH subtask, return estLowMin and estHighMin (integers, in minutes) representing how long the work will take a SOLO DEVELOPER who is driving the work through Claude Code (or a comparable agentic AI coding assistant). Claude writes most of the code, edits files in parallel, and handles the boilerplate — the human is reviewing, steering, and verifying, NOT hand-typing. Calibrate to THIS repo specifically using the file manifest and patterns you saw via list_directory / read_file.
  Do NOT pad for: typing speed, looking up syntax, scaffolding boilerplate, writing repetitive types/tests, or context-switching between files — the AI does these instantly.
  DO account for: reading and verifying AI output, debugging the genuinely tricky part, and product-level decisions the AI can't make on its own.
  Reference points for a solo dev driving Claude Code:
    • Small edit (rename, copy tweak, single-prop UI change): 2–6 min
    • New shadcn-style component or simple form field: 5–15 min
    • New API route or server action wired to one table: 10–30 min
    • New page or feature spanning 2–4 files: 20–60 min
    • Migration + types + UI + server action for a new column: 30–90 min
  The spread (high − low) should reflect uncertainty: tight (≤10 min spread) when the change is well-scoped to files you already inspected; wider when surface area is fuzzy or unknown. Never return estHighMin < estLowMin.`;

const FORBIDDEN_QUESTION_TOPICS = `Do NOT ask the user about anything that the linked repo can answer for you. Specifically, you MUST NOT ask about:
- The programming language or runtime (it is listed under "Languages:" above).
- Which framework, UI library, ORM, router, CSS / styling system, state library, build tool, or test runner is used (read the dependency manifest — package.json / pyproject.toml / go.mod / Cargo.toml / Gemfile / composer.json).
- Where a feature is displayed, rendered, or which file owns it (use search_code or list_directory to find it).
- The shape of an existing entity, table, record, response, or component's props (read the schema / type / model file).
- The naming or location of existing modules, routes, or endpoints (search the codebase).
- Any fact that has a definitive answer in a config file or existing source file.

If you would have asked one of the above, investigate the repo with your tools and use the answer in the task you generate instead. Save your questions for genuine product / intent ambiguity that no file can resolve.`;

function formatRepoContext(repoContext: RepoContext | null, opts: { withTools: boolean } = { withTools: false }): string {
  if (!repoContext) {
    return "Repo context: Not available — no linked repo. Work from the user's description alone. Do NOT call any tools.";
  }

  const lines: string[] = [
    `## Repo: ${repoContext.fullName} (branch: ${repoContext.defaultBranch})`,
  ];

  if (repoContext.description) {
    lines.push(`Description: ${repoContext.description}`);
  }

  if (repoContext.languages.length > 0) {
    lines.push(
      `Languages: ${repoContext.languages.map((l) => `${l.name} ${l.pct}%`).join(", ")}`
    );
  }

  if (repoContext.topLevelTree.length > 0) {
    lines.push(`\nTop-level structure:\n${repoContext.topLevelTree.slice(0, 40).join("\n")}`);
  }

  if (repoContext.fileManifest.length > 0) {
    const shown = repoContext.fileManifest.slice(0, MANIFEST_PROMPT_CAP);
    const remainder = repoContext.fileManifest.length - shown.length;
    const trailer = remainder > 0
      ? `\n…and ${remainder} more files. Use list_directory to explore further.`
      : repoContext.manifestTruncated
        ? "\n…manifest was truncated by GitHub. Use list_directory to explore further."
        : "";
    lines.push(`\nFile manifest (sample of ${shown.length}/${repoContext.fileManifest.length}):\n${shown.join("\n")}${trailer}`);
  }

  if (repoContext.readmeExcerpt) {
    lines.push(`\nREADME excerpt:\n${repoContext.readmeExcerpt}`);
  }

  if (repoContext.recentCommits.length > 0) {
    lines.push(
      `\nRecent commits:\n${repoContext.recentCommits
        .map((c) => `${c.sha} ${c.message}`)
        .join("\n")}`
    );
  }

  if (repoContext.degraded.length > 0) {
    lines.push(`\nNote: Some repo data was unavailable (${repoContext.degraded.join(", ")}).`);
  }

  if (opts.withTools) {
    lines.push(`\n${TOOL_GUIDANCE}`);
  }

  return lines.join("\n");
}

export function buildSystemPrompt(
  repoContext: RepoContext | null,
  opts: { forceSubtasks?: boolean } = {}
): string {
  const instructions = opts.forceSubtasks
    ? `You are an expert engineering task decomposer. You have already received the user's answers to clarifying questions. You MUST return subtasks now. Do NOT ask further questions.

Rules for subtasks:
- Each title must start with an imperative verb (e.g. "Add", "Update", "Write", "Fix", "Remove", "Test").
- Scope each subtask to one focused session or one PR. No subtask should take more than a few hours.
- If repo context is provided, reference real file paths, component names, or framework patterns from that context to make subtasks specific.
- Provide an optional one-sentence "rationale" only when the reason isn't obvious from the title.
- Return 3–8 subtasks; aim for the minimum number that fully covers the task.
${ESTIMATE_RULES}

Output format — respond ONLY with valid JSON in this exact shape:
{"kind":"subtasks","items":[{"title":"...","rationale":"...","estLowMin":30,"estHighMin":60},...]}
No markdown, no explanation, no wrapper — raw JSON only.`
    : `You are an expert engineering task decomposer. Your job is to break a software engineering task into 3–8 concrete, actionable subtasks, OR ask 2–4 short clarifying questions if the task is too vague to break down responsibly.

Rules for subtasks:
- Each title must start with an imperative verb (e.g. "Add", "Update", "Write", "Fix", "Remove", "Test").
- Scope each subtask to one focused session or one PR. No subtask should take more than a few hours.
- If repo context is provided, reference real file paths, component names, or framework patterns from that context to make subtasks specific.
- Provide an optional one-sentence "rationale" only when the reason isn't obvious from the title.
- Return 3–8 subtasks; aim for the minimum number that fully covers the task.
${ESTIMATE_RULES}

Rules for clarifying questions:
- Investigate the repo with your tools FIRST. Only ask a question after you have tried to answer it from the codebase and failed.
- ${FORBIDDEN_QUESTION_TOPICS}
- Only ask when a reasonable engineer could not infer the answer from the task, repo context, and what your tools showed you. Good questions are about product intent, not about facts that live in the code.
- Keep questions short (under 60 words each).
- Each question MUST include an "options" array of 3–5 mutually distinct, concrete candidate answers (each ≤80 chars), ranked from most likely to least likely given the task and repo context. Do NOT include an "Other" option — the UI adds that automatically.
- Options must be concrete answers a user can pick directly, not open-ended prompts.
- Return 2–4 questions. If after investigating you have no genuine product gaps, return subtasks instead.

Output format — respond ONLY with valid JSON in one of these two shapes:
{"kind":"subtasks","items":[{"title":"...","rationale":"...","estLowMin":30,"estHighMin":60},...]}
{"kind":"questions","items":[{"id":"q1","text":"...","options":["...","...","..."]},...]}
No markdown, no explanation, no wrapper — raw JSON only.`;

  return `${instructions}\n\n${formatRepoContext(repoContext, { withTools: repoContext !== null })}`;
}

export function buildUserPrompt(
  task: Pick<Task, "title" | "description">,
  attachments: Pick<TaskAttachment, "text_content">[],
  answers?: { questionId: string; answer: string }[]
): string {
  const parts: string[] = [`Task: ${task.title}`];

  if (task.description?.trim()) {
    parts.push(`\nDescription:\n${task.description.trim()}`);
  }

  const textAttachments = attachments
    .filter((a) => a.text_content?.trim())
    .map((a) => a.text_content!.trim());

  if (textAttachments.length > 0) {
    parts.push(`\nAttached context:\n${textAttachments.join("\n\n")}`);
  }

  if (answers && answers.length > 0) {
    parts.push(
      `\nAnswers to clarifying questions:\n${answers
        .map((a) => `[${a.questionId}] ${a.answer}`)
        .join("\n")}`
    );
  }

  parts.push("\nRespond with JSON only.");
  return parts.join("");
}

export function buildTaskSystemPrompt(
  repoContext: RepoContext | null,
  opts: { forceTask?: boolean } = {}
): string {
  const taskShape = `{
  "title": "imperative verb phrase, ≤80 chars, summarizes the deliverable",
  "description": "optional 1–3 short paragraphs of scope / acceptance criteria. Omit if title is self-evident.",
  "priority": "one of: low | medium | high | urgent",
  "subtasks": [{"title":"...","rationale":"...","estLowMin":30,"estHighMin":60}, ...]
}`;

  const instructions = opts.forceTask
    ? `You are an expert engineering task author. The user has answered clarifying questions. You MUST return a fully-formed task now. Do NOT ask further questions.

Rules for the task:
- title: imperative verb phrase, ≤80 chars (e.g. "Add Stripe checkout flow with webhook handler").
- description: ALWAYS write a thorough plain-language overview (≥20 chars, aim for 4–7 sentences). Describe in detail WHAT is being built and what it will do — the user-facing behavior, the flow end to end, and what the finished thing looks/feels like when used. Cover edge cases the user should know about (e.g. "if the user is logged out, they see…", "if no results are found, show…"). Write for a non-technical product owner: NO file paths, NO library names, NO function names, NO code-level detail. Do not describe implementation steps — those go in subtasks. Just explain the thing being delivered as a human would describe it.
- priority: infer from urgency cues in the user's text (default "medium"). Use "urgent" only if the user says it's blocking or time-critical.
- subtasks: 3–8 items, each starting with an imperative verb, scoped to one focused session or one PR. If repo context is provided, reference real file paths or framework patterns. Provide an optional one-sentence "rationale" only when the reason isn't obvious.
${ESTIMATE_RULES}

Output format — respond ONLY with valid JSON in this exact shape:
{"kind":"task","item":${taskShape}}
No markdown, no explanation, no wrapper — raw JSON only.`
    : `You are an expert engineering task author. Your job is to turn a free-text description into a fully-formed task (title, description, priority, 3–8 subtasks), OR ask 2–4 short clarifying questions if the description is too vague.

Rules for the task:
- title: imperative verb phrase, ≤80 chars (e.g. "Add Stripe checkout flow with webhook handler").
- description: ALWAYS write a thorough plain-language overview (≥20 chars, aim for 4–7 sentences). Describe in detail WHAT is being built and what it will do — the user-facing behavior, the flow end to end, and what the finished thing looks/feels like when used. Cover edge cases the user should know about (e.g. "if the user is logged out, they see…", "if no results are found, show…"). Write for a non-technical product owner: NO file paths, NO library names, NO function names, NO code-level detail. Do not describe implementation steps — those go in subtasks. Just explain the thing being delivered as a human would describe it.
- priority: infer from urgency cues in the user's text (default "medium"). Use "urgent" only if the user says it's blocking or time-critical.
- subtasks: 3–8 items, each starting with an imperative verb, scoped to one focused session or one PR. If repo context is provided, reference real file paths or framework patterns. Provide an optional one-sentence "rationale" only when the reason isn't obvious.
${ESTIMATE_RULES}

Rules for clarifying questions:
- Investigate the repo with your tools FIRST. Only ask a question after you have tried to answer it from the codebase and failed.
- ${FORBIDDEN_QUESTION_TOPICS}
- Only ask when a reasonable engineer could not infer scope, surface area, or output from the description, repo context, and what your tools showed you. Good questions are about product intent (default behavior, edge cases the user wants, scope boundaries), not about facts that live in the code.
- Keep questions short (under 60 words each).
- Each question MUST include an "options" array of 3–5 mutually distinct, concrete candidate answers (each ≤80 chars), ranked from most likely to least likely. Do NOT include an "Other" option — the UI adds that automatically.
- Return 2–4 questions. If after investigating you have no genuine product gaps, return the task instead.

Output format — respond ONLY with valid JSON in one of these two shapes:
{"kind":"task","item":${taskShape}}
{"kind":"questions","items":[{"id":"q1","text":"...","options":["...","...","..."]},...]}
No markdown, no explanation, no wrapper — raw JSON only.`;

  return `${instructions}\n\n${formatRepoContext(repoContext, { withTools: repoContext !== null })}`;
}

export function buildTaskUserPrompt(
  rawDescription: string,
  answers?: { questionId: string; answer: string }[]
): string {
  const parts: string[] = [`User description:\n${rawDescription.trim()}`];

  if (answers && answers.length > 0) {
    parts.push(
      `\nAnswers to clarifying questions:\n${answers
        .map((a) => `[${a.questionId}] ${a.answer}`)
        .join("\n")}`
    );
  }

  parts.push("\nRespond with JSON only.");
  return parts.join("");
}

export function buildEstimateTaskSystemPrompt(): string {
  return `You are a senior engineer estimating how long a software task will take a SOLO DEVELOPER who is driving the work through Claude Code (or a comparable agentic AI coding assistant). Claude writes most of the code, edits files in parallel, and handles the boilerplate — the human is reviewing, steering, and verifying, NOT hand-typing. You do NOT have access to the repo — base your estimate on the task title, description, and priority alone.

Estimate accordingly. Do NOT pad for: typing speed, looking up syntax, scaffolding boilerplate, writing repetitive types/tests, or context-switching between files — the AI does these instantly. DO account for: reading and verifying AI output, debugging the genuinely tricky part, and product-level decisions the AI can't make on its own.

Return a low/high range in HOURS that reflects realistic Claude-Code-driven velocity, not traditional team velocity and not cautious AI-assisted velocity. The range should reflect uncertainty: tight when the task is well-scoped, wider when the task is fuzzy, large, or unfamiliar.

Reference points for a solo dev driving Claude Code:
  • Trivial change (copy tweak, single prop, rename): 0.1–0.25 h
  • New simple component or form field: 0.25–0.5 h
  • New API route or server action wired to one table: 0.25–0.75 h
  • New page or feature spanning a few files: 0.75–2 h
  • Migration + types + UI + server action for a new column: 1–2.5 h
  • Multi-screen feature, integration with a 3rd-party API, or auth flow: 2–5 h
  • Whole subsystem, major refactor, complex stateful UI: 5–14 h

Rules:
- hoursLow and hoursHigh are decimals in hours (e.g. 0.1, 0.25, 1.25, 4).
- hoursHigh MUST be >= hoursLow.
- Round to the nearest 0.1 h for values under 1 h, otherwise nearest 0.25 h.
- Do not return 0; the minimum is 0.1.
- Treat "urgent" / "high" priority as a signal about importance, not about size — do not inflate or deflate the estimate based on priority alone.

Output format — respond ONLY with valid JSON in this exact shape:
{"hoursLow": 0.25, "hoursHigh": 0.75}
No markdown, no explanation, no wrapper — raw JSON only.`;
}

export function buildEstimateTaskUserPrompt(input: {
  title: string;
  description: string | null;
  priority: string;
}): string {
  const parts = [`Title: ${input.title}`, `Priority: ${input.priority}`];
  if (input.description?.trim()) {
    parts.push(`Description:\n${input.description.trim()}`);
  } else {
    parts.push("Description: (none)");
  }
  parts.push("\nRespond with JSON only.");
  return parts.join("\n");
}

export function buildSimplifyTasksSystemPrompt(): string {
  return `You are a translator that rewrites engineering tasks into plain English for a non-technical operator who is paying a developer to build software for them.

Your job is to preserve the meaning of each task exactly while replacing engineering jargon with everyday language. Do not invent scope, do not guess intent, do not omit anything substantive.

JARGON HANDLING — the most important rule:
- Whenever a technical term, product name, file format, protocol, or acronym appears, you MUST define it inline in parentheses on first mention, in ONE short line (≤12 words, plain words a non-engineer would know).
- This applies to BOTH the title and the description, every time the term first appears in that field.
- Examples of the format:
  - "S3 bucket (a storage folder hosted by Amazon's cloud)"
  - "AWS (Amazon's cloud-computing service that hosts our app)"
  - "JSON file (a plain-text file that stores structured data)"
  - "API (the doorway other programs use to talk to ours)"
  - "webhook (an automatic message our app sends when something happens)"
  - "OAuth (a standard way to let users log in with another account)"
  - "database (the place where our app stores all its records)"
  - "CDN (a network of servers that delivers files quickly worldwide)"
  - "cron job (a task the computer runs on a repeating schedule)"
  - "migration (a one-time script that updates the database structure)"
- Apply this to ANY term a non-developer would not instantly understand: cloud services (S3, EC2, Lambda, Vercel, Supabase, Firebase, Cloudflare), file formats (JSON, YAML, CSV, XML), protocols (HTTP, HTTPS, WebSocket, SMTP), frameworks (React, Next.js, Django), data structures (array, hash, queue), and concepts (cache, index, schema, payload, endpoint, middleware, refactor).
- After the first definition in a field, you may use the bare term again in the same field without re-defining.
- Do NOT define obvious everyday words (email, password, button, page).

Rules for each rewritten field:
- simpleTitle: imperative verb phrase, ≤80 chars when possible (longer is OK if a definition is needed). No file paths, no function names. Describe the user-visible outcome ("Add a way for customers to reset their password") not the implementation ("Wire up POST /api/auth/reset").
- simpleDescription: 1–3 short paragraphs of plain English describing what the finished thing does and what the operator will see. Skip code-level detail. If the original description is null or empty, return null.
- simpleSubtasks: same plain-English treatment for each subtask title. Inline definitions still apply on first mention within each subtask title. Keep the same id for each subtask. Preserve order.

Output format — respond ONLY with valid JSON in this exact shape:
{"items":[{"id":"<task-id>","simpleTitle":"...","simpleDescription":"..." | null,"simpleSubtasks":[{"id":"<subtask-id>","simpleTitle":"..."}]}]}

You MUST return one items entry per input task, using the same id. You MUST return one simpleSubtasks entry per input subtask for that task, using the same id. No markdown, no explanation, no wrapper — raw JSON only.`;
}

export interface SimplifyTaskInput {
  id: string;
  title: string;
  description: string | null;
  subtasks: { id: string; title: string }[];
}

export function buildSimplifyTasksUserPrompt(tasks: SimplifyTaskInput[]): string {
  const formatted = tasks.map((t) => {
    const lines = [`Task id: ${t.id}`, `Title: ${t.title}`];
    if (t.description?.trim()) {
      lines.push(`Description: ${t.description.trim()}`);
    } else {
      lines.push("Description: (none)");
    }
    if (t.subtasks.length > 0) {
      lines.push("Subtasks:");
      for (const s of t.subtasks) {
        lines.push(`  - id=${s.id} title=${s.title}`);
      }
    } else {
      lines.push("Subtasks: (none)");
    }
    return lines.join("\n");
  });

  return `Rewrite the following tasks in plain English for a non-technical operator.\n\n${formatted.join("\n\n---\n\n")}\n\nRespond with JSON only.`;
}

export function buildProjectProfileSystemPrompt(): string {
  return `You are summarizing a GitHub repository for a developer who wants to understand a project at a glance — what it is, who it's for, what features it has, and how active it is right now.

You have THREE tools to investigate the linked repo's codebase:
- list_directory(path) — list files/subdirectories at a path ("" for root).
- read_file(path) — read a text file's contents (capped at 50KB).
- search_code(query) — search for code matching a query (GitHub Code Search syntax).

INVESTIGATION IS REQUIRED. Do not answer from the prompt alone — the user message contains a quick snapshot, but the truth lives in the code. The accuracy of your answer depends on how thoroughly you read the repo, not on how fast you finish.

Phase 1 — Investigate. The following MINIMUMS are non-negotiable. You must complete them before producing any JSON. The "Pre-discovered integration signals" block (if present) speeds up the SERVICES field only — it does NOT reduce the investigation required for summary, audience, features, currentState, or stateRationale. Do not short-circuit.

MINIMUM 1 — README. read_file the project's README (e.g. "README.md", "readme.md", or whichever README path appears in the tree). REQUIRED, no exceptions.
  IMPORTANT: many repos have an unmodified create-next-app / create-react-app / framework boilerplate README that says nothing about what the project does. If you read the README and it only describes how to run the dev server, links to framework docs, or is fewer than ~10 lines of project-specific content — treat it as NO USEFUL CONTENT and rely on routes, components, and code for the features list instead. Do NOT pad features with framework boilerplate.

MINIMUM 2 — Dependency manifest. read_file the manifest for the dominant language(s):
- JavaScript/TypeScript → "package.json"
- Python → "pyproject.toml", "requirements.txt", or "setup.py"
- Go → "go.mod"
- Rust → "Cargo.toml"
- Ruby → "Gemfile"
- PHP → "composer.json"
- Java/Kotlin → "pom.xml" or "build.gradle"
REQUIRED.

MINIMUM 3 — Directory exploration. list_directory("") for the repo root, then list_directory on at least 3 of the most informative subfolders (e.g. "app", "src", "components", "pages", "lib", "routes", "server", "api", "schemas", "migrations", "prisma", "supabase", "db" — whichever exist). REQUIRED.

MINIMUM 4 — Source file reads. read_file on AT LEAST 5 load-bearing source files (target 6–10 for non-trivial repos). The user message includes a "User-facing routes" section listing every page and API endpoint in the app — USE IT. Each non-trivial route is a candidate feature; the path itself is usually descriptive (e.g. "/dashboard/fee-calculator" → there is a fee calculator). Pick files in this priority order:

1. Read the page.tsx (or equivalent) for routes whose names suggest specific functionality (anything beyond "/", "/login", "/signup", "/dashboard"). For example, "/dashboard/fee-calculator/page.tsx", "/dashboard/lawsuit-prediction/page.tsx", "/report/[id]/page.tsx" — open these to see what the feature actually does.
2. Read 1–2 entry / layout files (app/layout.tsx, app/page.tsx, src/index.ts, main.py, server.ts, cmd/main.go).
3. Read 1–2 schema / config files (prisma/schema.prisma, drizzle.config.ts, sanity.config.ts, supabase/config.toml, next.config.ts).
4. Read 1–2 feature modules from the "Feature-shaped component/module folders" section (if present in the user message) — these confirm what each feature lets the user do.

Do NOT read low-value files (lockfiles, build output, assets — these are already filtered out of the snapshot).
REQUIRED: at least 5 read_file calls on real source/config files. Fewer than 5 is inadequate investigation. For repos with 10+ routes, target 8–12 read_file calls.

MINIMUM 5 — Services discovery. The user message may include a "Pre-discovered integration signals" section listing env vars and API hostnames that a deterministic search already pulled out of the repo. If that section is present, EVERY signal in it MUST appear in your services output (mapped to its vendor). Do not silently drop signals. If the section is empty or missing entries, fall back to searching yourself:
   a. read_file on '.env.example', '.env.sample', '.env.local.example', '.env.development', or any similar file you see in the tree.
   b. search_code('API_KEY') and search_code('_TOKEN') to surface vendor-shaped env vars defined in source.
   c. search_code('https://api.') to surface external API hostnames in source.
   d. If the project deploys somewhere, search_code('vercel') / search_code('netlify') / search_code('cloudflare') to confirm hosting vendors that may not appear in deps.

Optional 6 — Feature deep-dives. If after the minimums above your features list still feels generic, search_code for domain terms from the README, or read_file additional feature modules. Better to do one or two extra reads than to produce a vague feature list.

Budget guidance: expect 15–25 tool calls and 6–10 read_file calls for a typical repo. If you finish in fewer than 5 read_file calls, you have NOT done enough investigation — go back and read more files before answering. The goal is accuracy, not speed.

Phase 2 — Answer:
Produce a JSON object with these fields:
- services: 0–10 short entries naming third-party SaaS, cloud, or developer-service VENDORS the project actually integrates with. Examples of common vendors: "AWS", "Vercel", "OpenAI", "Anthropic", "Supabase", "Firebase", "Stripe", "Resend", "Sanity", "Twilio", "Sentry", "PostHog", "Algolia", "Cloudflare", "GitHub", "Google Cloud", "Brave Search", "Perplexity", "Cohere", "Mapbox", "SerpAPI". The list is NOT exhaustive — include any external API the project calls.
  Identify a vendor if ANY of these are true:
    • a package matching the vendor is in the dependency manifest ('openai', '@supabase/*' → Supabase; 'stripe' → Stripe; '@aws-sdk/*' → AWS; 'resend' → Resend; '@sanity/*' → Sanity; 'firebase', 'firebase-admin' → Firebase; '@anthropic-ai/sdk' → Anthropic).
    • the source code references the vendor's API hostname (e.g. 'api.search.brave.com' → Brave Search; 'api.anthropic.com' → Anthropic; 'api.openai.com' → OpenAI; 'api.mapbox.com' → Mapbox).
    • an env var named after the vendor is referenced anywhere in source ('BRAVE_API_KEY' → Brave Search; 'PERPLEXITY_API_KEY' → Perplexity; 'MAPBOX_TOKEN' → Mapbox; 'COHERE_API_KEY' → Cohere).
    • a vendor-specific config file exists ('vercel.json', 'netlify.toml', 'wrangler.toml', '.firebaserc', 'sanity.config.*', 'supabase/config.toml').
  A vendor does NOT need an npm SDK to count — many APIs are called via raw fetch. Trust the hostname/env-var evidence equally with the manifest evidence.
  Each entry: { "name": "<Vendor>", "purpose": "<≤8-word note on what it's used for, e.g. 'database + auth', 'LLM for report generation', 'web search'>" }.
  Do NOT list languages, frameworks, runtimes, build tools, or local libraries here — those are NOT services. (No "Next.js", "React", "TypeScript", "Tailwind", "ESLint", "Vite".) Only outside vendors the project sends data to or pays for.
  Deduplicate (one entry per vendor).

- summary: 2–3 sentences. What this project DOES for its users, in plain language. Lead with the concrete user outcome, not the tech stack. (Good: "A signup flow that turns a few business questions into an AI-generated business plan." Bad: "A Next.js 15 app with Tailwind, Supabase, and OpenAI integration.")
- audience: 1–2 sentences. WHO this software is for and WHY they would care. Be specific about the real-world role (small business owners? agency operators? backend engineers? students?) and the problem the software solves for them. (Good: "Solo founders who need a business plan but can't afford a consultant — they answer five questions and get a report." Bad: "Users who want to use this application.") If the README doesn't say, infer from the routes, copy, and feature set you read; say "inferred from …" briefly.
- features: 3–8 short bullet phrases (each ≤ 12 words) naming USER-FACING CAPABILITIES — things an end user can DO or RECEIVE because of this software. Describe features the way the product's homepage or sales page would, not the way an engineer would describe the architecture.

  GOOD examples of features (concrete, user-perspective):
    • "Generate an AI business plan from five signup questions"
    • "Email weekly progress summaries to clients"
    • "Search the web inside chat using Brave Search"
    • "Estimate task duration with AI before starting"
    • "Track time spent per task and per project"
    • "Invite operators to a project via shareable link"

  BAD examples (these are TECH/IMPLEMENTATION, NOT features — never list these):
    • "Real-time UI updates"        ← that's how it's built, not what users get
    • "Server-side rendering"
    • "Type-safe API routes"
    • "Authentication middleware"
    • "Tailwind-based styling"
    • "Modular component architecture"
    • "REST API with Express"
    • "Database integration"
    • "Responsive design"

  Rule of thumb: if you can't say it as "users can X" or "the app Y for them", it's not a feature — drop it. If a candidate feature describes HOW (frameworks, infrastructure, patterns) instead of WHAT (user actions, user value), drop it.

  Source features from (in priority order):
    1. The "User-facing routes" section in the user message. EVERY non-trivial named route is a candidate feature — derive the feature name from the path and from reading the route's page.tsx. Examples from a real Next.js project: "/dashboard/fee-calculator" → "Fee calculator dashboard"; "/dashboard/lawsuit-prediction" → "Lawsuit outcome predictor"; "/agent-portal" → "Agent portal for case review"; "/api/property-coverage/scrape" → "Bulk property-coverage scraping".
    2. The "Feature-shaped component/module folders" section, if present — each non-generic folder name (not "ui", "primitives", "common") usually IS a feature surface area.
    3. README sections explicitly titled "Features" / "What it does" / "Capabilities" — only when the README has actual project content (not framework boilerplate).
    4. API endpoints that DO something concrete for users (e.g. /api/generate-report → "On-demand report generation"). Skip auth/utility endpoints.
  No duplicates. If a feature could be inferred from multiple sources, just list it once.
  If the routes section lists 8+ distinct feature-shaped routes, your features list should reflect that breadth — do not return only 3 features when there are clearly 6–8 distinct user-facing capabilities visible in the routes.
- currentState: one of: "early" | "active" | "mature" | "dormant".
    • "early" = recent commits exist but the project looks under-built (sparse tree, README placeholder-y).
    • "active" = multiple commits in the last few weeks and a substantial codebase.
    • "mature" = substantial codebase but commit cadence has slowed to occasional maintenance.
    • "dormant" = newest commit is months old or older.
- stateRationale: 1 sentence citing the specific evidence (e.g. "8 commits in the last 2 weeks across multiple subsystems" or "newest commit is 7 months ago").

Rules:
- Respond ONLY with raw JSON in the exact shape described. No markdown fences, no commentary.
- Do not output more than 8 features.
- Every feature MUST be backed by something you actually saw in the README or in a file you read — no guessing from folder names alone.
- Every feature MUST be expressible as a user action or user benefit. If a candidate feature is a framework name, architectural pattern, design system, build tool, deployment detail, or anything an engineer would put on a "tech stack" slide — DROP IT. Those belong in the services list (or nowhere).
- If a field would have to be a guess unsupported by what you read, keep it brief and honest ("README does not state the intended audience; based on the routes (X, Y), this appears to serve …").`;
}

type IntegrationSignalsInput = {
  envVars: { name: string; path: string }[];
  hostnames: { host: string; url: string; path: string }[];
};

type ExtractedRoutes = {
  pages: { route: string; file: string }[];
  apiRoutes: { route: string; file: string }[];
};

function appPathToRoute(folderPath: string): string {
  // folderPath is the dir containing page.tsx / route.ts, relative to "app/"
  // Strip Next.js route groups like "(group)" and parallel routes like "@slot".
  const segments = folderPath.split("/").filter((seg) => {
    if (!seg) return false;
    if (/^\(.+\)$/.test(seg)) return false; // (auth) route group
    if (/^@/.test(seg)) return false; // @modal parallel slot
    return true;
  });
  return "/" + segments.join("/");
}

function extractRoutes(manifest: string[]): ExtractedRoutes {
  const pages: { route: string; file: string }[] = [];
  const apiRoutes: { route: string; file: string }[] = [];
  const seen = new Set<string>();

  for (const path of manifest) {
    // App Router page (Next.js 13+ app/)
    let m = path.match(/^app\/(.*\/)?page\.(tsx|jsx|ts|js)$/);
    if (m) {
      const route = appPathToRoute(m[1] ?? "");
      const key = `page:${route}`;
      if (!seen.has(key)) {
        seen.add(key);
        pages.push({ route: route || "/", file: path });
      }
      continue;
    }

    // App Router route handler (Next.js 13+ app/)
    m = path.match(/^app\/(.*\/)?route\.(tsx|jsx|ts|js)$/);
    if (m) {
      const route = appPathToRoute(m[1] ?? "");
      const key = `api:${route}`;
      if (!seen.has(key)) {
        seen.add(key);
        apiRoutes.push({ route: route || "/", file: path });
      }
      continue;
    }

    // Pages Router (Next.js pages/)
    m = path.match(/^pages\/(.+)\.(tsx|jsx|ts|js)$/);
    if (m) {
      const rel = m[1];
      const base = rel.split("/").pop() ?? "";
      if (/^_/.test(base)) continue; // _app, _document, _error
      let route = "/" + rel.replace(/\/index$/, "").replace(/^index$/, "");
      if (route === "/") route = "/";
      const isApi = rel.startsWith("api/");
      const key = `${isApi ? "api" : "page"}:${route}`;
      if (!seen.has(key)) {
        seen.add(key);
        (isApi ? apiRoutes : pages).push({ route, file: path });
      }
      continue;
    }

    // SvelteKit / Remix-style src/routes/<path>/+page.svelte | route.tsx
    m = path.match(/^src\/routes\/(.*\/)?(\+page|route|index|page)\.(tsx|jsx|ts|js|svelte|vue|astro)$/);
    if (m) {
      const route = appPathToRoute(m[1] ?? "");
      const key = `page:${route}`;
      if (!seen.has(key)) {
        seen.add(key);
        pages.push({ route: route || "/", file: path });
      }
      continue;
    }
  }

  pages.sort((a, b) => a.route.localeCompare(b.route));
  apiRoutes.sort((a, b) => a.route.localeCompare(b.route));
  return { pages, apiRoutes };
}

// Folders under components/, src/components/, src/features/ that look feature-named.
function extractFeatureFolders(manifest: string[]): string[] {
  const folders = new Set<string>();
  for (const path of manifest) {
    const m = path.match(/^(?:src\/)?(?:components|features|modules)\/([^/]+)\/[^/]+/);
    if (!m) continue;
    const name = m[1];
    // Skip generic / primitive component folders.
    if (/^(ui|primitives?|common|shared|utils?|hooks?|icons?|layouts?|nav|navigation)$/i.test(name)) {
      continue;
    }
    folders.add(name);
  }
  return [...folders].sort();
}

export function buildProjectProfileUserPrompt(
  ctx: RepoContext,
  signals?: IntegrationSignalsInput
): string {
  const lines: string[] = [];
  lines.push(`Repository: ${ctx.fullName}`);
  lines.push(`Default branch: ${ctx.defaultBranch}`);
  lines.push(`Description: ${ctx.description ?? "(none)"}`);
  lines.push("");

  if (ctx.languages.length > 0) {
    const langs = ctx.languages.map((l) => `${l.name} ${l.pct}%`).join(", ");
    lines.push(`Languages: ${langs}`);
  } else {
    lines.push("Languages: (none reported)");
  }
  lines.push("");

  if (ctx.topLevelTree.length > 0) {
    lines.push("Top-level tree:");
    for (const item of ctx.topLevelTree) lines.push(`  ${item}`);
  } else {
    lines.push("Top-level tree: (empty)");
  }
  lines.push("");

  const routes = extractRoutes(ctx.fileManifest);
  if (routes.pages.length > 0 || routes.apiRoutes.length > 0) {
    lines.push("User-facing routes (every entry below is a real page or API endpoint in this app — derived from page.tsx / route.ts paths in the manifest). When the README is generic, THIS is your primary signal for what the product does:");
    if (routes.pages.length > 0) {
      lines.push(`  Pages (${routes.pages.length}):`);
      for (const r of routes.pages.slice(0, 80)) {
        lines.push(`    ${r.route}   ← ${r.file}`);
      }
      if (routes.pages.length > 80) lines.push(`    …(+${routes.pages.length - 80} more)`);
    }
    if (routes.apiRoutes.length > 0) {
      lines.push(`  API endpoints (${routes.apiRoutes.length}):`);
      for (const r of routes.apiRoutes.slice(0, 60)) {
        lines.push(`    ${r.route}   ← ${r.file}`);
      }
      if (routes.apiRoutes.length > 60) lines.push(`    …(+${routes.apiRoutes.length - 60} more)`);
    }
    lines.push("");
  }

  const featureFolders = extractFeatureFolders(ctx.fileManifest);
  if (featureFolders.length > 0) {
    lines.push(`Feature-shaped component/module folders (${featureFolders.length}, may indicate features even if no route mentions them):`);
    lines.push(`  ${featureFolders.slice(0, 30).join(", ")}`);
    if (featureFolders.length > 30) lines.push(`  …(+${featureFolders.length - 30} more)`);
    lines.push("");
  }

  if (ctx.recentCommits.length > 0) {
    lines.push(`Recent commits (newest first, up to ${ctx.recentCommits.length}):`);
    for (const c of ctx.recentCommits) {
      lines.push(`  ${c.date.slice(0, 10)} ${c.sha} — ${c.message}`);
    }
  } else {
    lines.push("Recent commits: (none retrieved)");
  }
  lines.push("");

  if (ctx.readmeExcerpt.trim()) {
    lines.push("README excerpt:");
    lines.push("```");
    lines.push(ctx.readmeExcerpt);
    lines.push("```");
  } else {
    lines.push("README excerpt: (none)");
  }
  lines.push("");

  if (ctx.degraded.length > 0) {
    lines.push(`Note: the following fields failed to fetch and may be empty: ${ctx.degraded.join(", ")}`);
    lines.push("");
  }

  if (signals && (signals.envVars.length > 0 || signals.hostnames.length > 0)) {
    lines.push("Pre-discovered integration signals (found by a deterministic search before this turn — trust them as concrete evidence of vendor integration):");
    if (signals.envVars.length > 0) {
      lines.push("  Env vars referenced in source code:");
      for (const ev of signals.envVars) {
        lines.push(`    - ${ev.name}  (seen in ${ev.path})`);
      }
    }
    if (signals.hostnames.length > 0) {
      lines.push("  External API hostnames referenced in source code:");
      for (const h of signals.hostnames) {
        lines.push(`    - ${h.host}  (seen in ${h.path}, as ${h.url})`);
      }
    }
    lines.push("");
    lines.push("Each of the above is direct evidence that the repo integrates with the corresponding vendor — include it in the services list. Examples of env-var → vendor mapping:");
    lines.push("  BRAVE_* → Brave Search; ANTHROPIC_* → Anthropic; PERPLEXITY_* → Perplexity; COHERE_* → Cohere; MAPBOX_* → Mapbox; SERPAPI_* → SerpAPI; ALGOLIA_* → Algolia; SENTRY_* → Sentry; POSTHOG_* → PostHog; TWILIO_* → Twilio; CLERK_* → Clerk; AUTH0_* → Auth0; PINECONE_* → Pinecone; OPENAI_* → OpenAI; STRIPE_* → Stripe; RESEND_* → Resend.");
    lines.push("If a discovered env var or hostname doesn't match any vendor you know, you MAY open the file it appears in (read_file the path shown) to confirm — but do not silently drop a discovered signal.");
    lines.push("");
  }

  lines.push("Respond with JSON only.");
  return lines.join("\n");
}
