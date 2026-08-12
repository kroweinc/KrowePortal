// Hand-added ("local") branches — the branch picker's answer to work that lives
// on a branch GitHub has never seen.
//
// A builder working solo commits to a feature branch and pushes it days later,
// or never. Until then the branch is invisible to the portal: the chips are
// built from the GitHub branch listing, so the only honest options are the repo
// default or "No branch", and the staging board loses the grouping the branch
// was for. Typing the name in stores it as a local branch, which behaves like
// any other chip until the push makes it real.
//
// This module is the pure half of that: what counts as a branch name, and which
// local branch a freshly pushed GitHub branch turns out to be. Kept free of
// server imports so both the client picker and the sync path can use it, and so
// the matching rules are testable on their own.

/** Matches the `tasks.branch_name` / `repo_branches` ceiling the actions enforce. */
export const MAX_BRANCH_NAME_LENGTH = 200;

/**
 * The identity of a branch for *matching* purposes, ignoring the spellings that
 * differ between what a builder types and what they end up pushing: case, and
 * which separator sits between words. "Feature/Add Login", "feature/add-login"
 * and "feature_add_login" are all one branch by this key.
 *
 * Deliberately lossy — it exists only to pair a hand-typed name with the real
 * branch that later shows up on GitHub. Never store or display the result.
 */
export function normalizeBranchKey(name: string): string {
  return name
    .trim()
    .replace(/^refs\/heads\//, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Validate a hand-typed branch name against the rules `git check-ref-format`
 * enforces, so the portal can't hold a name git would refuse to create. Returns
 * the cleaned name (trimmed, `refs/heads/` prefix dropped) or a message written
 * for the builder rather than for git.
 */
export function validateBranchName(raw: string): { name: string } | { error: string } {
  const name = raw.trim().replace(/^refs\/heads\//, "");

  if (!name) return { error: "Type a branch name first." };
  if (name.length > MAX_BRANCH_NAME_LENGTH) {
    return { error: `Branch names cap at ${MAX_BRANCH_NAME_LENGTH} characters.` };
  }
  if (/\s/.test(name)) return { error: "Branch names can't contain spaces — try a dash." };
  if (/[\x00-\x1f\x7f~^:?*[\\]/.test(name)) {
    return { error: "Branch names can't contain ~ ^ : ? * [ or \\." };
  }
  if (name.includes("..") || name.includes("@{") || name === "@") {
    return { error: 'Branch names can\'t contain ".." or "@{".' };
  }
  if (name.startsWith("/") || name.endsWith("/") || name.includes("//")) {
    return { error: 'Branch names can\'t start, end, or double up on "/".' };
  }
  for (const segment of name.split("/")) {
    if (segment.startsWith(".") || segment.endsWith(".") || segment.endsWith(".lock")) {
      return { error: 'No part of a branch name can start or end with "." or end with ".lock".' };
    }
  }
  return { name };
}

/**
 * What a fresh GitHub branch listing means for the local branches recorded
 * against the same repo. Three outcomes, one per local name:
 *
 *   adopted — GitHub now lists that exact name. Nothing to move: the sync's
 *             upsert rewrites the row as a GitHub branch, and every task already
 *             points at the right string.
 *   renamed — GitHub lists the same branch under a different spelling (the
 *             builder typed "Ship Emails", the push landed as "ship-emails").
 *             The local row and the tasks filed under it move to GitHub's name,
 *             so the builder is left with one chip instead of two for one branch.
 *   kept    — still unpushed. Stays exactly as it is.
 *
 * Two local names can legitimately resolve to the same GitHub branch (two
 * spellings of one thing) — both are renamed onto it, which is the dedupe.
 * `githubNames` order decides which spelling wins when several GitHub branches
 * share a normalized key; callers pass the ordered list (default branch first).
 */
export type LocalBranchReconcile = {
  adopted: string[];
  renamed: { from: string; to: string }[];
  kept: string[];
};

export function reconcileLocalBranches(
  localNames: string[],
  githubNames: string[]
): LocalBranchReconcile {
  const live = new Set(githubNames);
  const byKey = new Map<string, string>();
  for (const name of githubNames) {
    const key = normalizeBranchKey(name);
    if (key && !byKey.has(key)) byKey.set(key, name);
  }

  const out: LocalBranchReconcile = { adopted: [], renamed: [], kept: [] };
  for (const local of localNames) {
    if (live.has(local)) {
      out.adopted.push(local);
      continue;
    }
    const match = byKey.get(normalizeBranchKey(local));
    if (match) out.renamed.push({ from: local, to: match });
    else out.kept.push(local);
  }
  return out;
}
