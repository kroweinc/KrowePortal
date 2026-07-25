import type { TaskType } from "@/lib/types";

/**
 * The deterministic safety net under the commit→task matcher.
 *
 * Deliberately its own module with no OpenAI import: these are domain rules, not
 * model plumbing, and keeping them here means they can be unit-tested without
 * dragging in lib/ai/client.ts (which throws at import time when OPENAI_API_KEY
 * is unset — i.e. in CI).
 */

export type CommitMatchCandidate = {
  sha: string;
  /** Full message (subject + body); the prompt builder truncates it. */
  message: string;
  committedAt: string | null;
};

export type TaskMatchCandidate = {
  id: string;
  title: string;
  description: string | null;
  type: TaskType | null;
  tags: string[];
};

/** A task candidate plus the timestamp the age guard needs. */
export type TaskMatchInput = TaskMatchCandidate & { createdAt: string };

export type CommitMatch = {
  sha: string;
  taskId: string;
  confidence: number;
  reason: string;
};

/** Structural shape of one raw match, as CommitTaskMatchResult infers it. */
type RawMatch = {
  sha: string;
  taskId: string;
  confidence: number;
  reason: string;
};

/**
 * Below this we record the commit as "scanned, no match". Set high on purpose:
 * a false positive strikes a builder's live task through and tells them work
 * they haven't finished is done. A missed match costs nothing — the task is
 * still sitting on their board.
 */
export const MATCH_CONFIDENCE_THRESHOLD = 0.8;

/**
 * Keep only the matches that survive every rule the prompt already asks for.
 * Pure, so the rules hold whether or not the model complied.
 */
export function filterCommitMatches(
  raw: RawMatch[],
  commits: CommitMatchCandidate[],
  tasks: TaskMatchInput[]
): CommitMatch[] {
  const commitBySha = new Map(commits.map((c) => [c.sha, c]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const best = new Map<string, CommitMatch>();

  for (const m of raw) {
    const commit = commitBySha.get(m.sha);
    const task = taskById.get(m.taskId);
    // A sha or id we never sent is a hallucination, not a match.
    if (!commit || !task) continue;
    if (m.confidence < MATCH_CONFIDENCE_THRESHOLD) continue;

    // A commit cannot have finished a task that did not exist yet. Cheapest,
    // highest-value guard we have — it kills the "same area, older work" class
    // of false positive outright. An unknown commit date can't disprove
    // anything, so it falls through to the builder's confirmation instead.
    if (commit.committedAt && commit.committedAt < task.createdAt) continue;

    // One commit closes at most one task; keep the strongest claim.
    const existing = best.get(m.sha);
    if (existing && existing.confidence >= m.confidence) continue;

    best.set(m.sha, {
      sha: m.sha,
      taskId: m.taskId,
      confidence: m.confidence,
      reason: m.reason.trim(),
    });
  }

  return [...best.values()];
}
