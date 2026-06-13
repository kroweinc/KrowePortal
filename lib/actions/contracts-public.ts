"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { getBuilderIdentityForOwner, type BuilderIdentity } from "@/lib/actions/builder-identity";
import type { Contract } from "@/lib/types";

const TOKEN_RE = /^[a-f0-9]{64}$/;

export interface PublicContract {
  contract: Contract;
  builderName: string;
  projectName: string | null;
  builder: BuilderIdentity;
}

// Public, no-auth lookup of a contract by token. Admin client + token is
// the capability. Draft and rejected contracts are never exposed.
export async function getContractByToken(token: string): Promise<PublicContract | null> {
  if (!TOKEN_RE.test(token)) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("contracts")
    .select("*, project:projects(name, owner_id, owner:profiles!owner_id(display_name))")
    .eq("token", token)
    .maybeSingle();

  if (!data) return null;

  const row = data as Record<string, unknown> & {
    project?: {
      name?: string | null;
      owner_id?: string | null;
      owner?: { display_name?: string | null } | null;
    } | null;
  };
  if (row.status === "draft" || row.status === "rejected") return null;

  const builderName = row.project?.owner?.display_name ?? "Your builder";
  const projectName = row.project?.name ?? null;
  const builder = await getBuilderIdentityForOwner(admin, row.project?.owner_id, builderName);

  const { project: _p, ...contractRow } = row;
  return { contract: contractRow as unknown as Contract, builderName, projectName, builder };
}
