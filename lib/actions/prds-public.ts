"use server";

import { createAdminClient } from "@/lib/supabase/server";
import type { Prd } from "@/lib/types";

const TOKEN_RE = /^[a-f0-9]{64}$/;

export interface PublicPrd {
  prd: Prd;
  builderName: string;
  projectName: string | null;
}

// Public, no-auth lookup of a PRD by token. Admin client + token is the
// capability. Draft and rejected PRDs are never exposed.
export async function getPrdByToken(token: string): Promise<PublicPrd | null> {
  if (!TOKEN_RE.test(token)) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("prds")
    .select("*, project:projects(name, owner:profiles!owner_id(display_name))")
    .eq("token", token)
    .maybeSingle();

  if (!data) return null;

  const row = data as Record<string, unknown> & {
    project?: { name?: string | null; owner?: { display_name?: string | null } | null } | null;
  };
  if (row.status === "draft" || row.status === "rejected") return null;

  const builderName = row.project?.owner?.display_name ?? "Your builder";
  const projectName = row.project?.name ?? null;

  const { project: _p, ...prdRow } = row;
  return { prd: prdRow as unknown as Prd, builderName, projectName };
}
