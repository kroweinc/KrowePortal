import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import {
  generateBranchPurposes,
  type BranchPurposeInput,
} from "@/lib/ai/generate-branch-purposes";

type BranchForPurpose = {
  name: string;
  tipShaFull: string;
  latestCommit: { message: string; date: string } | null;
};

async function readCachedPurposes(
  repoFullName: string,
  branches: BranchForPurpose[]
): Promise<Map<string, string>> {
  if (branches.length === 0) return new Map();

  const supabase = createAdminClient();
  const map = new Map<string, string>();

  // Look up each (branch_name, tip_sha) pair; the table is keyed by all three columns.
  // Doing this in one query with an OR-filtered IN is awkward in PostgREST, so we
  // fetch all rows for the repo and filter client-side. Branch counts are small
  // (capped well below 200) so this is fine.
  const { data, error } = await supabase
    .from("branch_purposes")
    .select("branch_name, tip_sha, purpose")
    .eq("repo_full_name", repoFullName);

  if (error) {
    console.error("[getBranchPurposes] read failed", {
      repo: repoFullName,
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
    });
    return map;
  }

  const wanted = new Map(branches.map((b) => [b.name, b.tipShaFull] as const));
  for (const row of data as { branch_name: string; tip_sha: string; purpose: string }[]) {
    const wantSha = wanted.get(row.branch_name);
    if (wantSha && wantSha === row.tip_sha) {
      map.set(row.branch_name, row.purpose);
    }
  }
  return map;
}

async function persistPurposes(
  repoFullName: string,
  branches: BranchForPurpose[],
  generated: Record<string, string>,
  model: string
): Promise<void> {
  const rows = branches
    .filter((b) => generated[b.name] !== undefined && b.tipShaFull.length > 0)
    .map((b) => ({
      repo_full_name: repoFullName,
      branch_name: b.name,
      tip_sha: b.tipShaFull,
      purpose: generated[b.name],
      model,
    }));

  if (rows.length === 0) return;

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("branch_purposes")
    .upsert(rows, { onConflict: "repo_full_name,branch_name,tip_sha" });

  if (error) {
    console.error("[getBranchPurposes] persist failed", {
      repo: repoFullName,
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
    });
  }
}

export async function getBranchPurposes(
  repoFullName: string,
  branches: BranchForPurpose[]
): Promise<Record<string, string>> {
  if (branches.length === 0) return {};

  const cached = await readCachedPurposes(repoFullName, branches);
  const missing = branches.filter((b) => !cached.has(b.name));

  const result: Record<string, string> = {};
  for (const [name, purpose] of cached.entries()) result[name] = purpose;

  if (missing.length === 0) return result;

  try {
    const inputs: BranchPurposeInput[] = missing.map((b) => ({
      name: b.name,
      latestCommitMessage: b.latestCommit?.message ?? null,
    }));
    const { byBranch, model } = await generateBranchPurposes(repoFullName, inputs);
    await persistPurposes(repoFullName, missing, byBranch, model);
    Object.assign(result, byBranch);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[getBranchPurposes] generation failed", {
      repo: repoFullName,
      error: msg,
    });
  }

  return result;
}
