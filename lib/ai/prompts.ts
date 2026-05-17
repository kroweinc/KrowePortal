import type { RepoContext } from "@/lib/github/types";
import type { Task, TaskAttachment } from "@/lib/types";

export function buildSystemPrompt(repoContext: RepoContext | null): string {
  const instructions = `You are an expert engineering task decomposer. Your job is to break a software engineering task into 3–8 concrete, actionable subtasks, OR ask 2–4 short clarifying questions if the task is too vague to break down responsibly.

Rules for subtasks:
- Each title must start with an imperative verb (e.g. "Add", "Update", "Write", "Fix", "Remove", "Test").
- Scope each subtask to one focused session or one PR. No subtask should take more than a few hours.
- If repo context is provided, reference real file paths, component names, or framework patterns from that context to make subtasks specific.
- Provide an optional one-sentence "rationale" only when the reason isn't obvious from the title.
- Return 3–8 subtasks; aim for the minimum number that fully covers the task.

Rules for clarifying questions:
- Only ask questions when a reasonable engineer could not infer the answer from the task and repo context.
- Keep questions short (under 60 words each). Include an optional "hint" showing a plausible default.
- Return 2–4 questions.

Output format — respond ONLY with valid JSON in one of these two shapes:
{"kind":"subtasks","items":[{"title":"...","rationale":"..."},...]}
{"kind":"questions","items":[{"id":"q1","text":"...","hint":"..."},...]}
No markdown, no explanation, no wrapper — raw JSON only.`;

  if (!repoContext) {
    return `${instructions}\n\nRepo context: Not available — generate subtasks from the task description alone.`;
  }

  const degradedNote =
    repoContext.degraded.length > 0
      ? `\nNote: Some repo data was unavailable (${repoContext.degraded.join(", ")}).`
      : "";

  const lines: string[] = [
    instructions,
    "",
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

  if (degradedNote) lines.push(degradedNote);

  return lines.join("\n");
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
