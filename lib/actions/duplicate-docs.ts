"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { getPrdById } from "@/lib/actions/prds";
import { getQuoteById } from "@/lib/actions/quote-docs";
import { getContractById } from "@/lib/actions/contracts";
import { syncDocumentContext } from "@/lib/context/sync-document";
import { recordDocumentEvent } from "@/lib/context/document-events";

/* Duplicate a PRD / quote / contract into a fresh draft. Mirrors the insert
   shape of each doc's draft* action: a new row is created with a copy of the
   content + source notes, status forced to "draft", and a brand-new public
   token minted by the table default. Status/lifecycle stamps (sent_at,
   signed_at, …) are deliberately NOT copied — a duplicate always starts clean.
   Best-effort context sync + event recording match the originals. */

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : await createClient();
}

type DupResult = { id: string } | { error: string };

export async function duplicatePrd(id: string): Promise<DupResult> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can duplicate a PRD." };

  const src = await getPrdById(id);
  if (!src) return { error: "PRD not found." };

  const title = `Copy of ${src.title}`;
  const supabase = await getClient(profile.id);
  const { data, error } = await supabase
    .from("prds")
    .insert({
      project_id: src.project_id,
      created_by: profile.id,
      title,
      status: "draft",
      content: src.content,
      source_notes: src.source_notes,
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Failed to duplicate PRD." };

  await syncDocumentContext({
    docKind: "prd",
    docId: data.id as string,
    projectId: src.project_id,
    title,
    content: src.content,
    builderId: profile.id,
  });
  await recordDocumentEvent({
    docKind: "prd",
    docId: data.id as string,
    projectId: src.project_id,
    eventType: "created",
    actorId: profile.id,
    actorRole: "builder",
  });

  revalidatePath(`/b/projects/${src.project_id}`);
  return { id: data.id as string };
}

export async function duplicateQuote(id: string): Promise<DupResult> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can duplicate a quote." };

  const src = await getQuoteById(id);
  if (!src) return { error: "Quote not found." };

  const title = `Copy of ${src.title}`;
  const supabase = await getClient(profile.id);
  const { data, error } = await supabase
    .from("quotes")
    .insert({
      project_id: src.project_id,
      created_by: profile.id,
      title,
      status: "draft",
      content: src.content,
      source_notes: src.source_notes,
      source_prd_id: src.source_prd_id ?? null,
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Failed to duplicate quote." };

  await syncDocumentContext({
    docKind: "quote",
    docId: data.id as string,
    projectId: src.project_id,
    title,
    content: src.content,
    builderId: profile.id,
  });
  await recordDocumentEvent({
    docKind: "quote",
    docId: data.id as string,
    projectId: src.project_id,
    eventType: "created",
    actorId: profile.id,
    actorRole: "builder",
  });

  revalidatePath(`/b/projects/${src.project_id}`);
  return { id: data.id as string };
}

export async function duplicateContract(id: string): Promise<DupResult> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can duplicate a contract." };

  const src = await getContractById(id);
  if (!src) return { error: "Contract not found." };

  const title = `Copy of ${src.title}`;
  const supabase = await getClient(profile.id);
  const { data, error } = await supabase
    .from("contracts")
    .insert({
      project_id: src.project_id,
      created_by: profile.id,
      title,
      status: "draft",
      content: src.content,
      source_notes: src.source_notes,
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Failed to duplicate contract." };

  await syncDocumentContext({
    docKind: "contract",
    docId: data.id as string,
    projectId: src.project_id,
    title,
    content: src.content,
    builderId: profile.id,
  });
  await recordDocumentEvent({
    docKind: "contract",
    docId: data.id as string,
    projectId: src.project_id,
    eventType: "created",
    actorId: profile.id,
    actorRole: "builder",
  });

  revalidatePath(`/b/projects/${src.project_id}`);
  return { id: data.id as string };
}
