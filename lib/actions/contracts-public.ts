"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import type { Contract } from "@/lib/types";

const TOKEN_RE = /^[a-f0-9]{64}$/;

export interface PublicContract {
  contract: Contract;
  builderName: string;
  projectName: string | null;
}

// Public, no-auth lookup of a contract by token. Admin client + token is
// the capability. Draft and rejected contracts are never exposed.
export async function getContractByToken(token: string): Promise<PublicContract | null> {
  if (!TOKEN_RE.test(token)) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("contracts")
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

  const { project: _p, ...contractRow } = row;
  return { contract: contractRow as unknown as Contract, builderName, projectName };
}

export async function signContract(
  token: string,
  input: { signerName: string; consent: boolean }
): Promise<{ success: true } | { error: string }> {
  if (!TOKEN_RE.test(token)) return { error: "Invalid contract link." };

  const signerName = input.signerName?.trim() ?? "";
  if (signerName.length < 2) return { error: "Please type your full name to sign." };
  if (signerName.length > 200) return { error: "Name is too long." };
  if (!input.consent) return { error: "You must agree to the terms to sign." };

  const admin = createAdminClient();
  const { data: contract } = await admin
    .from("contracts")
    .select("id, status, project_id")
    .eq("token", token)
    .maybeSingle();

  if (!contract) return { error: "Contract not found." };
  if (contract.status !== "sent") return { error: "This contract is not awaiting signature." };

  const hdr = await headers();
  const ip = (hdr.get("x-forwarded-for")?.split(",")[0] ?? hdr.get("x-real-ip") ?? "").trim() || null;

  const now = new Date().toISOString();
  const { error } = await admin
    .from("contracts")
    .update({
      status: "signed",
      signed_at: now,
      signed_by_name: signerName,
      signer_ip: ip,
      signature_consent: true,
      updated_at: now,
    })
    .eq("token", token)
    .eq("status", "sent");

  if (error) return { error: error.message };

  revalidatePath(`/contract/${token}`);
  revalidatePath(`/b/projects/${contract.project_id as string}`);
  revalidatePath(`/b/projects/${contract.project_id as string}/contract/${contract.id as string}`);
  return { success: true };
}
