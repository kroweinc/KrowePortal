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

Output format — respond ONLY with valid JSON in this exact shape:
{"kind":"subtasks","items":[{"title":"...","rationale":"..."},...]}
No markdown, no explanation, no wrapper — raw JSON only.`
    : `You are an expert engineering task decomposer. Your job is to break a software engineering task into 3–8 concrete, actionable subtasks, OR ask 2–4 short clarifying questions if the task is too vague to break down responsibly.

Rules for subtasks:
- Each title must start with an imperative verb (e.g. "Add", "Update", "Write", "Fix", "Remove", "Test").
- Scope each subtask to one focused session or one PR. No subtask should take more than a few hours.
- If repo context is provided, reference real file paths, component names, or framework patterns from that context to make subtasks specific.
- Provide an optional one-sentence "rationale" only when the reason isn't obvious from the title.
- Return 3–8 subtasks; aim for the minimum number that fully covers the task.

Rules for clarifying questions:
- Investigate the repo with your tools FIRST. Only ask a question after you have tried to answer it from the codebase and failed.
- ${FORBIDDEN_QUESTION_TOPICS}
- Only ask when a reasonable engineer could not infer the answer from the task, repo context, and what your tools showed you. Good questions are about product intent, not about facts that live in the code.
- Keep questions short (under 60 words each).
- Each question MUST include an "options" array of 3–5 mutually distinct, concrete candidate answers (each ≤80 chars), ranked from most likely to least likely given the task and repo context. Do NOT include an "Other" option — the UI adds that automatically.
- Options must be concrete answers a user can pick directly, not open-ended prompts.
- Return 2–4 questions. If after investigating you have no genuine product gaps, return subtasks instead.

Output format — respond ONLY with valid JSON in one of these two shapes:
{"kind":"subtasks","items":[{"title":"...","rationale":"..."},...]}
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
  "subtasks": [{"title":"...","rationale":"..."}, ...]
}`;

  const instructions = opts.forceTask
    ? `You are an expert engineering task author. The user has answered clarifying questions. You MUST return a fully-formed task now. Do NOT ask further questions.

Rules for the task:
- title: imperative verb phrase, ≤80 chars (e.g. "Add Stripe checkout flow with webhook handler").
- description: ALWAYS write a thorough plain-language overview (≥20 chars, aim for 4–7 sentences). Describe in detail WHAT is being built and what it will do — the user-facing behavior, the flow end to end, and what the finished thing looks/feels like when used. Cover edge cases the user should know about (e.g. "if the user is logged out, they see…", "if no results are found, show…"). Write for a non-technical product owner: NO file paths, NO library names, NO function names, NO code-level detail. Do not describe implementation steps — those go in subtasks. Just explain the thing being delivered as a human would describe it.
- priority: infer from urgency cues in the user's text (default "medium"). Use "urgent" only if the user says it's blocking or time-critical.
- subtasks: 3–8 items, each starting with an imperative verb, scoped to one focused session or one PR. If repo context is provided, reference real file paths or framework patterns. Provide an optional one-sentence "rationale" only when the reason isn't obvious.

Output format — respond ONLY with valid JSON in this exact shape:
{"kind":"task","item":${taskShape}}
No markdown, no explanation, no wrapper — raw JSON only.`
    : `You are an expert engineering task author. Your job is to turn a free-text description into a fully-formed task (title, description, priority, 3–8 subtasks), OR ask 2–4 short clarifying questions if the description is too vague.

Rules for the task:
- title: imperative verb phrase, ≤80 chars (e.g. "Add Stripe checkout flow with webhook handler").
- description: ALWAYS write a thorough plain-language overview (≥20 chars, aim for 4–7 sentences). Describe in detail WHAT is being built and what it will do — the user-facing behavior, the flow end to end, and what the finished thing looks/feels like when used. Cover edge cases the user should know about (e.g. "if the user is logged out, they see…", "if no results are found, show…"). Write for a non-technical product owner: NO file paths, NO library names, NO function names, NO code-level detail. Do not describe implementation steps — those go in subtasks. Just explain the thing being delivered as a human would describe it.
- priority: infer from urgency cues in the user's text (default "medium"). Use "urgent" only if the user says it's blocking or time-critical.
- subtasks: 3–8 items, each starting with an imperative verb, scoped to one focused session or one PR. If repo context is provided, reference real file paths or framework patterns. Provide an optional one-sentence "rationale" only when the reason isn't obvious.

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
