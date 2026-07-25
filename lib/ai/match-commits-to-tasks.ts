import { runChat, AI_MODEL } from "./client";
import type { AiCallMeta } from "./usage";
import { CommitTaskMatchResult } from "./schemas";
import { jsonResponseFormat, stripNullsDeep } from "./strict-schema";
import { buildMatchCommitsSystemPrompt, buildMatchCommitsUserPrompt } from "./prompts";
import {
  filterCommitMatches,
  type CommitMatch,
  type CommitMatchCandidate,
  type TaskMatchInput,
} from "@/lib/tasks/commit-match-filter";

export type { CommitMatch, CommitMatchCandidate, TaskMatchInput };

// One call per chunk. 30 commits is ~2 weeks of a busy solo repo, and keeps the
// task list close enough to the commits to stay in the model's attention.
const MAX_COMMITS_PER_CALL = 30;

async function callOnce(
  input: {
    repoFullName: string;
    branch: string;
    commits: CommitMatchCandidate[];
    tasks: TaskMatchInput[];
  },
  meta?: AiCallMeta
): Promise<CommitMatch[]> {
  const request = async (): Promise<string> => {
    const response = await runChat(
      {
        model: AI_MODEL,
        max_completion_tokens: 2000,
        response_format: jsonResponseFormat(CommitTaskMatchResult, "commit_task_matches"),
        messages: [
          { role: "system", content: buildMatchCommitsSystemPrompt() },
          { role: "user", content: buildMatchCommitsUserPrompt(input) },
        ],
      },
      meta
    );
    return response.choices[0]?.message?.content ?? "";
  };

  const tryParse = (rawText: string): CommitTaskMatchResult | null => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return null;
    }
    const result = CommitTaskMatchResult.safeParse(stripNullsDeep(parsed));
    return result.success ? result.data : null;
  };

  // Same resample-once contract as classifyTask: a truncated or malformed first
  // sample self-corrects, a second failure is real. Unlike classifyTask we do
  // NOT throw on a second miss — the scan is a background safeguard, and no
  // suggestions is a fine outcome. Returning [] lets the caller still write the
  // "scanned, no match" memos so it won't re-bill this batch on the next load.
  const result = tryParse(await request()) ?? tryParse(await request());
  if (!result) {
    console.warn("[matchCommitsToTasks] response did not match the expected shape", {
      repo: input.repoFullName,
      commits: input.commits.length,
    });
    return [];
  }

  return filterCommitMatches(result.matches, input.commits, input.tasks);
}

/**
 * Ask the model which of these default-branch commits finish which open tasks.
 * Returns only high-confidence, whitelist-checked matches — usually none.
 */
export async function matchCommitsToTasks(
  input: {
    repoFullName: string;
    branch: string;
    commits: CommitMatchCandidate[];
    tasks: TaskMatchInput[];
  },
  meta?: AiCallMeta
): Promise<{ matches: CommitMatch[]; model: string }> {
  if (input.commits.length === 0 || input.tasks.length === 0) {
    return { matches: [], model: AI_MODEL };
  }

  const matches: CommitMatch[] = [];
  for (let i = 0; i < input.commits.length; i += MAX_COMMITS_PER_CALL) {
    const chunk = input.commits.slice(i, i + MAX_COMMITS_PER_CALL);
    matches.push(...(await callOnce({ ...input, commits: chunk }, meta)));
  }

  return { matches, model: AI_MODEL };
}
