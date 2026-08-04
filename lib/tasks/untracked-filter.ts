import type { TaskPriority, TaskType } from "@/lib/types";
import type { DraftConfidence } from "@/lib/ai/schemas";
import { findSimilarTitles, titlesAreSimilar, type TitleCandidate } from "./dedupe";

/**
 * The deterministic safety net under the untracked-work scan.
 *
 * Same posture and the same reason for existing as commit-match-filter: domain
 * rules, not model plumbing, in their own module with no OpenAI import so they
 * unit-test without dragging in lib/ai/client.ts (which throws at import time
 * when OPENAI_API_KEY is unset — i.e. in CI).
 *
 * The asymmetry that sets every threshold here: a missed gap costs nothing —
 * the work shipped either way and the builder can still write the task by hand.
 * A false one invents a task for work that was already tracked, or for a lint
 * pass, and lands it on the client's changelog. Prefer silence.
 */

/** A proposed task as the model returns it, before any of the rules below. */
export type UntrackedWorkCandidate = {
  title: string;
  description: string;
  priority: TaskPriority;
  type: TaskType;
  tags: string[];
  /** Commits the model says back this claim. */
  shas: string[];
  files: string[];
  confidence: DraftConfidence;
};

/** What the push carried, as far as the filter cares. */
export type PushEvidence = {
  commits: { sha: string; subject: string }[];
};

/** Beyond this the card stops being a nudge and becomes a backlog to triage. */
export const MAX_GAPS_PER_PUSH = 4;

/**
 * Commit subjects that are never a forgotten task on their own.
 *
 * The prompt asks for this too. It's repeated here because the rule is cheap,
 * exact, and the failure it prevents ("Bump dependencies" proposed as a
 * deliverable, shown to a client) is the most embarrassing one available.
 */
const NOISE_SUBJECT = new RegExp(
  [
    "^merge\\b", // merge commits — the push's own plumbing
    "^revert\\b",
    "^(chore|ci|build|style)(\\(.*\\))?\\s*:", // conventional-commit housekeeping
    "^(bump|release|version)\\b",
    "^v?\\d+\\.\\d+\\.\\d+", // version tags
    "\\b(lint|prettier|eslint|formatting|reformat|whitespace|typo)\\b",
    "^(wip|tmp|temp|test|stuff|misc|cleanup|fixup?|amend)\\b", // says nothing
  ].join("|"),
  "i"
);

export function isNoiseSubject(subject: string): boolean {
  return NOISE_SUBJECT.test(subject.trim());
}

/**
 * Keep only the proposals that survive every rule the prompt already asks for.
 * Pure, so the rules hold whether or not the model complied.
 *
 * `existingTitles` must be EVERY task in the engagement, not just the open ones.
 * The whole premise is that a matching task might already be done — checking
 * only open tasks would re-propose work that shipped correctly.
 */
export function filterUntrackedItems(
  raw: UntrackedWorkCandidate[],
  push: PushEvidence,
  existingTitles: TitleCandidate[]
): UntrackedWorkCandidate[] {
  const subjectBySha = new Map(push.commits.map((c) => [c.sha, c.subject]));
  const kept: UntrackedWorkCandidate[] = [];

  for (const item of raw) {
    const title = item.title.trim();
    if (title.length < 3) continue;

    // A sha we never sent is a hallucination. Keeping the item minus its bad
    // shas would leave a claim with no evidence behind it, so they're dropped
    // first and the item stands or falls on what's left.
    const shas = [...new Set(item.shas)].filter((s) => subjectBySha.has(s));
    if (shas.length === 0) continue;

    // "Not sure this was really its own piece of work" is not worth a card.
    if (item.confidence === "low") continue;

    // Every commit behind it is housekeeping — there's no deliverable here.
    if (shas.every((s) => isNoiseSubject(subjectBySha.get(s) ?? ""))) continue;

    // Someone already wrote this task. Free, no model call, and the guard that
    // does the most work: the scan runs over pushes whose tasks are done, and
    // a done task is invisible to every other check here.
    if (findSimilarTitles(title, existingTitles).length > 0) continue;

    // Two proposals for the same deliverable inside one push — keep the first,
    // which is the model's own ordering (strongest first).
    if (kept.some((k) => titlesAreSimilar(k.title, title))) continue;

    kept.push({ ...item, title, shas });
    if (kept.length >= MAX_GAPS_PER_PUSH) break;
  }

  return kept;
}
