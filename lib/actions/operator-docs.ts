"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import type { Quote, Contract, Prd, Engagement } from "@/lib/types";

type EngagementRef = Pick<Engagement, "id" | "project_id" | "operator_id">;

/**
 * The distinct project ids an operator may read documents for, gathered across
 * ALL of their engagements rather than just the most recent one. Project
 * documents are RLS-restricted to the project's builder, so the operator reads
 * them through the admin client only after we verify they own each engagement
 * (dev profiles bypass). Project-less engagements ("Shared space" invites)
 * contribute nothing here — they carry tasks, not project documents.
 */
async function operatorProjectIds(engagements: EngagementRef[]): Promise<string[] | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const isDev = DEV_PROFILE_IDS.has(profile.id);
  const ids = new Set<string>();
  for (const e of engagements) {
    if (!isDev && e.operator_id !== profile.id) continue; // authorize per engagement
    if (e.project_id) ids.add(e.project_id);
  }
  return [...ids];
}

export interface OperatorSignedDocs {
  quotes: Quote[];
  contracts: Contract[];
  prds: Prd[];
}

/**
 * The signed Quotes / Contracts / PRDs an operator should see, aggregated across
 * every project linked to any of their engagements. Returns all matches so a
 * client working across multiple projects sees each project's finalized
 * documents, not only the newest engagement's.
 */
export async function getSignedDocsForEngagements(
  engagements: EngagementRef[]
): Promise<OperatorSignedDocs> {
  const empty: OperatorSignedDocs = { quotes: [], contracts: [], prds: [] };

  const projectIds = await operatorProjectIds(engagements);
  if (!projectIds || projectIds.length === 0) return empty;

  const admin = createAdminClient();
  const [quoteRes, contractRes, prdRes] = await Promise.all([
    admin
      .from("quotes")
      .select("*")
      .in("project_id", projectIds)
      .in("status", ["signed", "accepted"])
      .order("signed_at", { ascending: false, nullsFirst: false }),
    admin
      .from("contracts")
      .select("*")
      .in("project_id", projectIds)
      .eq("status", "signed")
      .order("signed_at", { ascending: false, nullsFirst: false }),
    admin
      .from("prds")
      .select("*")
      .in("project_id", projectIds)
      .eq("status", "signed")
      .order("signed_at", { ascending: false, nullsFirst: false }),
  ]);

  return {
    quotes: (quoteRes.data ?? []) as Quote[],
    contracts: (contractRes.data ?? []) as Contract[],
    prds: (prdRes.data ?? []) as Prd[],
  };
}

export interface OperatorPendingDocs {
  quotes: Quote[];
  contracts: Contract[];
  prds: Prd[];
}

/**
 * The sent-but-not-yet-signed Quotes / Contracts / PRDs an operator should see —
 * the documents waiting on their signature — aggregated across every project
 * linked to any of their engagements. Once an operator is linked to an
 * engagement (by accepting a doc or invite), anything the builder sends on that
 * engagement's project shows up here automatically, alongside every other
 * project they're engaged on. Returns all matches since documents accumulate
 * over an engagement's life.
 */
export async function getPendingDocsForEngagements(
  engagements: EngagementRef[]
): Promise<OperatorPendingDocs> {
  const empty: OperatorPendingDocs = { quotes: [], contracts: [], prds: [] };

  const projectIds = await operatorProjectIds(engagements);
  if (!projectIds || projectIds.length === 0) return empty;

  const admin = createAdminClient();
  const [quoteRes, contractRes, prdRes] = await Promise.all([
    admin
      .from("quotes")
      .select("*")
      .in("project_id", projectIds)
      .eq("status", "sent")
      .order("sent_at", { ascending: false, nullsFirst: false }),
    admin
      .from("contracts")
      .select("*")
      .in("project_id", projectIds)
      .eq("status", "sent")
      .order("sent_at", { ascending: false, nullsFirst: false }),
    admin
      .from("prds")
      .select("*")
      .in("project_id", projectIds)
      .eq("status", "sent")
      .order("sent_at", { ascending: false, nullsFirst: false }),
  ]);

  return {
    quotes: (quoteRes.data ?? []) as Quote[],
    contracts: (contractRes.data ?? []) as Contract[],
    prds: (prdRes.data ?? []) as Prd[],
  };
}
