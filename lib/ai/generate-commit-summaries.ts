import { openai, AI_MODEL } from "./client";

const MAX_COMMITS_PER_CALL = 30;

export type CommitCategory =
  | "feature"
  | "fix"
  | "cleanup"
  | "docs"
  | "infra"
  | "other";

export type CommitSummaryInput = {
  sha: string;
  message: string;
};

export type CommitSummary = {
  summary: string;
  category: CommitCategory;
};

export type CommitSummariesResult = {
  bySha: Record<string, CommitSummary>;
  model: string;
};

const VALID_CATEGORIES: CommitCategory[] = [
  "feature",
  "fix",
  "cleanup",
  "docs",
  "infra",
  "other",
];

const SYSTEM_PROMPT = `You translate git commit messages into plain English for a non-technical business owner who is paying a developer to build their software. They want to know what their developer just did, in language they would actually understand.

For each commit, produce:
- summary: ONE short sentence (≤110 chars). No jargon, no file names, no function names, no acronyms unless you immediately define them in parentheses on first use. Describe what the user-visible change does, not the implementation. Start with a present-tense verb.
- category: one of "feature" (added new capability), "fix" (fixed a bug or broken behavior), "cleanup" (refactored, renamed, or removed unused code without changing behavior), "docs" (documentation only), "infra" (build tooling, deps, CI, config), "other" (anything that doesn't fit).

GOOD examples:
- "Added a way for operators to invite a builder by emailing them a link." → feature
- "Fixed the issue where the task list wouldn't refresh after marking something done." → fix
- "Cleaned up the signup form code so it's easier to change later." → cleanup
- "Wrote setup instructions for new developers joining the project." → docs
- "Upgraded the database connection library to the latest version." → infra

BAD examples (do NOT do this):
- "Refactored TaskList component" (jargon, file name)
- "Bumped @supabase/ssr to 0.5.1" (mentions package + version)
- "fix: handle null in useAuth hook" (jargon, file name, no explanation)

If a commit message is too vague to translate honestly (e.g. "wip", "stuff", "asdf"), summarize it as "Small in-progress change by the developer." and mark it "other".

Output ONLY valid JSON in this shape:
{ "commits": { "<sha>": { "summary": "<sentence>", "category": "<category>" }, ... } }

Include every commit from the input in the output map, keyed by its sha.`;

function buildUserPrompt(
  repoFullName: string,
  inputs: CommitSummaryInput[]
): string {
  const list = inputs.map((c) => ({
    sha: c.sha,
    message: c.message,
  }));
  return [
    `Repository: ${repoFullName}`,
    `Commits:`,
    JSON.stringify(list, null, 2),
  ].join("\n");
}

function normalizeCategory(value: unknown): CommitCategory {
  if (typeof value !== "string") return "other";
  const lowered = value.toLowerCase();
  return (VALID_CATEGORIES as string[]).includes(lowered)
    ? (lowered as CommitCategory)
    : "other";
}

async function callOnce(
  repoFullName: string,
  inputs: CommitSummaryInput[]
): Promise<Record<string, CommitSummary>> {
  if (inputs.length === 0) return {};

  const requestRaw = async (): Promise<string> => {
    const response = await openai.chat.completions.create({
      model: AI_MODEL,
      max_completion_tokens: 1500,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(repoFullName, inputs) },
      ],
    });
    return response.choices[0]?.message?.content ?? "";
  };

  // json_object very occasionally returns non-JSON (or truncates); resample once
  // before failing — the model reliably self-corrects.
  const parseCommits = (
    raw: string
  ): Record<string, { summary?: unknown; category?: unknown }> | null => {
    try {
      return (
        JSON.parse(raw) as {
          commits?: Record<string, { summary?: unknown; category?: unknown }>;
        }
      ).commits ?? {};
    } catch {
      return null;
    }
  };

  const commits = parseCommits(await requestRaw()) ?? parseCommits(await requestRaw());
  if (!commits) {
    throw new Error("Commit summaries: AI returned non-JSON");
  }

  const out: Record<string, CommitSummary> = {};
  for (const input of inputs) {
    const entry = commits[input.sha];
    if (!entry || typeof entry.summary !== "string") continue;
    const summary = entry.summary.trim();
    if (!summary) continue;
    out[input.sha] = {
      summary: summary.length > 220 ? summary.slice(0, 220) : summary,
      category: normalizeCategory(entry.category),
    };
  }
  return out;
}

export async function generateCommitSummaries(
  repoFullName: string,
  inputs: CommitSummaryInput[]
): Promise<CommitSummariesResult> {
  const bySha: Record<string, CommitSummary> = {};

  for (let i = 0; i < inputs.length; i += MAX_COMMITS_PER_CALL) {
    const chunk = inputs.slice(i, i + MAX_COMMITS_PER_CALL);
    const result = await callOnce(repoFullName, chunk);
    Object.assign(bySha, result);
  }

  return { bySha, model: AI_MODEL };
}
