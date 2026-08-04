import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import type { ReleaseGap, ReleaseGapCommit } from "@/lib/types";

/**
 * Unresolved "this push shipped work with no task" proposals, keyed by release
 * id. Read server-side only: release_gaps has RLS on with no policies (service
 * role only), and every caller here has already scoped the release ids to
 * releases the viewer can see.
 *
 * A plain object rather than a Map because it crosses into the client
 * StagingBoard, same as branchesByEngagement and stagingGroupsByEngagement.
 * Mirrors getPendingCommitMatches — same shape, same rationale.
 */

type GapRow = Omit<ReleaseGap, "evidence" | "tags" | "files"> & {
  evidence: unknown;
  tags: string[] | null;
  files: string[] | null;
};

const GAP_COLUMNS =
  "id, release_id, engagement_id, repo_full_name, title, description, priority, type, tags, confidence, evidence, files, created_at";

/** jsonb comes back as unknown — keep only entries that can actually render. */
function parseEvidence(value: unknown): ReleaseGapCommit[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const { sha, subject, url } = entry as Record<string, unknown>;
    if (typeof sha !== "string" || sha.length === 0) return [];
    return [
      {
        sha,
        subject: typeof subject === "string" ? subject : "",
        url: typeof url === "string" ? url : "",
      },
    ];
  });
}

export async function getPendingReleaseGaps(
  releaseIds: string[]
): Promise<Record<string, ReleaseGap[]>> {
  const out: Record<string, ReleaseGap[]> = {};
  if (releaseIds.length === 0) return out;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("release_gaps")
    .select(GAP_COLUMNS)
    .in("release_id", releaseIds)
    .eq("state", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[getPendingReleaseGaps] read failed", { error: error.message });
    return out;
  }

  for (const row of (data ?? []) as GapRow[]) {
    const gap: ReleaseGap = {
      ...row,
      tags: (row.tags ?? []) as ReleaseGap["tags"],
      files: row.files ?? [],
      evidence: parseEvidence(row.evidence),
    };
    (out[row.release_id] ??= []).push(gap);
  }

  return out;
}
