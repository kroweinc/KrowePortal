import type { RepoContext } from "@/lib/github/types";
import type { Task, Subtask, TaskAttachment } from "@/lib/types";

export type AgentVariant = "claude-code" | "cursor" | "chatgpt";

const MANIFEST_PROMPT_CAP = 200;

const VARIANT_LABELS: Record<AgentVariant, string> = {
  "claude-code": "Claude Code (Anthropic's CLI coding agent)",
  cursor: "Cursor (IDE-based coding agent)",
  chatgpt: "ChatGPT (general-purpose chat, no repo access)",
};

const COMMON_GUIDANCE = `You are an expert engineering prompt author. Your job is to write a single high-quality implementation prompt that another AI coding agent will execute against the repo described below.

You have tools to read this repo's codebase: list_directory(path), read_file(path), and search_code(query). You MUST investigate before writing the prompt — never write a prompt from the task description alone.

Phase 1 — Investigate (required, before any output):
1. Read the dependency manifest for the language(s) listed under "Languages:" (e.g. "package.json", "pyproject.toml", "go.mod", "Cargo.toml", "Gemfile", "composer.json"). This tells you the actual frameworks, ORM, router, CSS system, and conventions.
2. list_directory the folders the task most likely touches (e.g. "components", "app", "src", "lib") and any folder the user named.
3. read_file or search_code to locate the specific files the task will need to modify or create. Find the closest existing analog if you're adding something new.
4. Read 1–3 of the most relevant existing files so the prompt can quote real patterns, naming, and imports from this codebase.

Phase 2 — Author the prompt:
- The output is a prompt to be COPY-PASTED into another AI coding agent. Write in second person ("You will…", "Read…", "Edit…").
- Be specific. Reference real file paths from this repo. Quote real function/component names. Do not invent paths.
- Include a brief "Context" section, a clear "What to build" section, an "Acceptance criteria" checklist, and a "Files of interest" section.
- Do NOT include the original task title verbatim as the only context — re-frame it for the agent with all the repo grounding you discovered.
- Keep the prompt focused on this one task. Do not pad with generic engineering advice.`;

const VARIANT_AUTHORING: Record<AgentVariant, string> = {
  "claude-code": `Audience: Claude Code, Anthropic's CLI coding agent.
- The agent runs in a terminal inside the user's local clone of this repo. It has Read, Edit, Write, Bash, Grep, and Glob tools and can run the project's dev server / tests directly.
- Reference files by their **repo-relative path** (e.g. \`components/foo.tsx\`, \`lib/bar.ts\`). The agent will resolve these against its working directory.
- Suggest a small 3–6 item todo list the agent should track with TaskCreate at the start of work.
- For non-trivial changes (3+ files or schema changes), tell the agent to enter plan mode first and confirm the plan with the user before editing.
- End the prompt with an explicit verification step: which command to run (npm run build / lint / test) and which UI flow to manually exercise.`,
  cursor: `Audience: Cursor, an IDE-based coding agent.
- The agent works inside an open IDE with file tabs. It uses @-mention syntax to pull files into context and produces apply-diff suggestions.
- Use \`@path/to/file.ts\` syntax when referencing files the agent should open (e.g. "Open @components/foo.tsx"). Use this consistently for every file reference.
- Open the prompt by listing the @-mentioned files the agent should pull into context FIRST, before describing the change.
- Prefer "produce a unified diff" framing — Cursor's strength is reviewable edits, not autonomous multi-step execution.
- End with a "Verification" section listing the commands and the manual UI flow.`,
  chatgpt: `Audience: ChatGPT, a chat assistant with NO repo access.
- The agent CANNOT read files on its own. The prompt must be fully self-contained.
- Pick the 1–3 single most load-bearing files for this task and inline their FULL relevant contents as fenced code blocks (\`\`\`tsx ... \`\`\`) inside the prompt. Truncate aggressively — only inline what the agent needs to write the change.
- Each inlined file MUST be preceded by its repo-relative path as a header line (e.g. "### \`components/foo.tsx\`").
- Ask the agent to return modified files as fenced code blocks with the same header format, so the user can paste them back.
- Do NOT reference files the agent can't see. If you mention a related file for context, summarize what it does inline — don't ask the agent to "look at" it.`,
};

const OUTPUT_FORMAT = `Output format — respond ONLY with valid JSON in this exact shape:
{
  "prompt": "the full prompt the user will copy-paste into the agent. Markdown formatting OK. Should be 200–1500 words. No JSON wrapper inside this string.",
  "filesReferenced": ["array of repo-relative file paths you actually inspected or referenced in the prompt", "..."],
  "notes": "one short sentence (<200 chars) describing the approach the prompt takes — shown to the user as a sanity check"
}
No markdown, no explanation, no wrapper outside the JSON object — raw JSON only.`;

function formatRepoContext(repoContext: RepoContext): string {
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

  return lines.join("\n");
}

export function buildBuildPromptSystemPrompt(
  repoContext: RepoContext,
  variant: AgentVariant
): string {
  return [
    COMMON_GUIDANCE,
    "",
    `## Target agent`,
    `You are writing this prompt for: **${VARIANT_LABELS[variant]}**.`,
    "",
    VARIANT_AUTHORING[variant],
    "",
    formatRepoContext(repoContext),
    "",
    OUTPUT_FORMAT,
  ].join("\n");
}

export function buildBuildPromptUserPrompt(
  task: Pick<Task, "title" | "description" | "priority">,
  subtasks: Pick<Subtask, "title">[],
  attachments: Pick<TaskAttachment, "text_content" | "file_name" | "attachment_type" | "url">[]
): string {
  const parts: string[] = [`# Task to implement`, ``, `**Title:** ${task.title}`, `**Priority:** ${task.priority}`];

  if (task.description?.trim()) {
    parts.push(``, `**Description:**`, task.description.trim());
  }

  if (subtasks.length > 0) {
    parts.push(``, `**Subtasks (already broken down by the operator):**`);
    for (const s of subtasks) {
      parts.push(`- ${s.title}`);
    }
  }

  const textAttachments = attachments
    .filter((a) => a.text_content?.trim())
    .map((a) => `### ${a.file_name}\n${a.text_content!.trim()}`);
  if (textAttachments.length > 0) {
    parts.push(``, `**Attached context (text notes):**`, ...textAttachments);
  }

  const linkAttachments = attachments
    .filter((a) => a.attachment_type === "link" && a.url)
    .map((a) => `- ${a.file_name}: ${a.url}`);
  if (linkAttachments.length > 0) {
    parts.push(``, `**Attached links:**`, ...linkAttachments);
  }

  const fileAttachments = attachments
    .filter((a) => a.attachment_type === "file")
    .map((a) => `- ${a.file_name}`);
  if (fileAttachments.length > 0) {
    parts.push(``, `**Attached files (referenced by name only, contents not available here):**`, ...fileAttachments);
  }

  parts.push(``, `Investigate the repo, then write the implementation prompt. Respond with JSON only.`);
  return parts.join("\n");
}
