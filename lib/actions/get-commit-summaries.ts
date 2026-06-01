import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import {
  generateCommitSummaries,
  type CommitCategory,
  type CommitSummary,
  type CommitSummaryInput,
} from "@/lib/ai/generate-commit-summaries";

export type CommitForSummary = {
  sha: string;
  message: string;
};

type CommitSummaryRow = {
  commit_sha: string;
  summary: string;
  category: string;
};

async function readCachedSummaries(
  repoFullName: string,
  commits: CommitForSummary[]
): Promise<Map<string, CommitSummary>> {
  if (commits.length === 0) return new Map();

  const supabase = createAdminClient();
  const shas = commits.map((c) => c.sha).filter((s) => s.length > 0);
  if (shas.length === 0) return new Map();

  const { data, error } = await supabase
    .from("commit_summaries")
    .select("commit_sha, summary, category")
    .eq("repo_full_name", repoFullName)
    .in("commit_sha", shas);

  const map = new Map<string, CommitSummary>();
  if (error) {
    console.error("[getCommitSummaries] read failed", {
      repo: repoFullName,
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
    });
    return map;
  }

  for (const row of (data ?? []) as CommitSummaryRow[]) {
    map.set(row.commit_sha, {
      summary: row.summary,
      category: row.category as CommitCategory,
    });
  }
  return map;
}

async function persistSummaries(
  repoFullName: string,
  generated: Record<string, CommitSummary>,
  model: string
): Promise<void> {
  const rows = Object.entries(generated).map(([sha, entry]) => ({
    repo_full_name: repoFullName,
    commit_sha: sha,
    summary: entry.summary,
    category: entry.category,
    model,
  }));

  if (rows.length === 0) return;

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("commit_summaries")
    .upsert(rows, { onConflict: "repo_full_name,commit_sha" });

  if (error) {
    console.error("[getCommitSummaries] persist failed", {
      repo: repoFullName,
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
    });
  }
}

export async function getCommitSummaries(
  repoFullName: string,
  commits: CommitForSummary[]
): Promise<Record<string, CommitSummary>> {
  if (commits.length === 0) return {};

  const cached = await readCachedSummaries(repoFullName, commits);
  const missing = commits.filter(
    (c) => c.sha.length > 0 && !cached.has(c.sha)
  );

  const result: Record<string, CommitSummary> = {};
  for (const [sha, entry] of cached.entries()) result[sha] = entry;

  if (missing.length === 0) return result;

  try {
    const inputs: CommitSummaryInput[] = missing.map((c) => ({
      sha: c.sha,
      message: c.message,
    }));
    const { bySha, model } = await generateCommitSummaries(
      repoFullName,
      inputs
    );
    await persistSummaries(repoFullName, bySha, model);
    Object.assign(result, bySha);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[getCommitSummaries] generation failed", {
      repo: repoFullName,
      error: msg,
    });
  }

  return result;
}
