"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { getProjectById } from "@/lib/actions/projects";
import { getBriefsByProject } from "@/lib/actions/briefs";
import { getPrdsByProject } from "@/lib/actions/prds";
import { generateContractDraft } from "@/lib/ai/generate-contract";
import type { Contract, ContractContent, BriefContent, PrdContent } from "@/lib/types";

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : await createClient();
}

function revalidateContract(projectId: string, id: string, token?: string | null) {
  revalidatePath(`/b/projects/${projectId}`);
  revalidatePath(`/b/projects/${projectId}/contract/${id}`);
  if (token) revalidatePath(`/contract/${token}`);
}

// The contract should stay consistent with the project's quote. Prefer a
// signed quote, then the most recent sent one, then the latest draft.
async function bestQuoteContent(projectId: string): Promise<BriefContent | undefined> {
  const quotes = await getBriefsByProject(projectId);
  if (quotes.length === 0) return undefined;
  const signed = quotes.find((q) => q.status === "signed");
  const sent = quotes.find((q) => q.status === "sent");
  return (signed ?? sent ?? quotes[0]).content;
}

// The contract's scope of services and deliverables should reflect the
// project's PRD. Same selection logic as the quote: signed, then sent, then
// the latest draft. Returns undefined if the project has no PRD yet.
async function bestPrdContent(projectId: string): Promise<PrdContent | undefined> {
  const prds = await getPrdsByProject(projectId);
  if (prds.length === 0) return undefined;
  const signed = prds.find((p) => p.status === "signed");
  const sent = prds.find((p) => p.status === "sent");
  return (signed ?? sent ?? prds[0]).content;
}

const createSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1, "Give the contract a title.").max(200),
  notes: z.string().min(1, "Paste some notes to draft from.").max(20000),
  providerName: z.string().max(200).optional(),
});

export async function createContractDraft(
  formData: FormData
): Promise<{ error: string } | void> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders can create contracts." };

  const parsed = createSchema.safeParse({
    projectId: formData.get("projectId"),
    title: formData.get("title"),
    notes: formData.get("notes"),
    providerName: formData.get("providerName") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const project = await getProjectById(parsed.data.projectId);
  if (!project) return { error: "Project not found." };
  if (project.owner_id !== profile.id) return { error: "Not your project." };

  const quoteContent = await bestQuoteContent(parsed.data.projectId);
  const prdContent = await bestPrdContent(parsed.data.projectId);
  const content = await generateContractDraft({
    title: parsed.data.title,
    notes: parsed.data.notes,
    providerName: parsed.data.providerName ?? profile.display_name ?? undefined,
    clientName: project.prospect_name ?? project.name,
    quoteContent,
    prdContent,
  });

  const supabase = await getClient(profile.id);
  const { data, error } = await supabase
    .from("contracts")
    .insert({
      project_id: parsed.data.projectId,
      created_by: profile.id,
      title: parsed.data.title,
      status: "draft",
      content,
      source_notes: parsed.data.notes,
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Failed to create contract." };

  revalidatePath(`/b/projects/${parsed.data.projectId}`);
  redirect(`/b/projects/${parsed.data.projectId}/contract/${data.id as string}`);
}

export async function regenerateContract(
  id: string,
  notes: string
): Promise<{ success: true; content: ContractContent } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can edit a contract." };

  const clean = (notes ?? "").trim();
  if (clean.length < 1) return { error: "Paste some notes to draft from." };
  if (clean.length > 20000) return { error: "Notes are too long." };

  const supabase = await getClient(profile.id);
  const { data: before } = await supabase
    .from("contracts")
    .select("status, created_by, title, project_id, token")
    .eq("id", id)
    .single();

  if (!before) return { error: "Contract not found." };
  if (before.created_by !== profile.id) return { error: "Not your contract." };
  if (before.status !== "draft") return { error: "Only drafts can be regenerated." };

  const project = await getProjectById(before.project_id as string);
  const quoteContent = await bestQuoteContent(before.project_id as string);
  const prdContent = await bestPrdContent(before.project_id as string);
  const content = await generateContractDraft({
    title: before.title as string,
    notes: clean,
    providerName: profile.display_name ?? undefined,
    clientName: project?.prospect_name ?? project?.name,
    quoteContent,
    prdContent,
  });

  const { error } = await supabase
    .from("contracts")
    .update({ content, source_notes: clean, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidateContract(before.project_id as string, id, before.token as string | null);
  return { success: true, content };
}

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.record(z.string(), z.unknown()).optional(),
});

export async function updateContractContent(
  id: string,
  updates: { title?: string; content?: ContractContent }
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can edit a contract." };

  const parsed = updateSchema.safeParse({
    title: updates.title,
    content: updates.content as Record<string, unknown> | undefined,
  });
  if (!parsed.success) return { error: "Invalid input." };

  const supabase = await getClient(profile.id);
  const { data: before } = await supabase
    .from("contracts")
    .select("status, created_by, project_id, token")
    .eq("id", id)
    .single();

  if (!before) return { error: "Contract not found." };
  if (before.created_by !== profile.id) return { error: "Not your contract." };
  if (before.status === "signed") return { error: "Signed contracts can't be edited." };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.content !== undefined) patch.content = parsed.data.content;

  const { error } = await supabase.from("contracts").update(patch).eq("id", id);
  if (error) return { error: error.message };

  revalidateContract(before.project_id as string, id, before.token as string | null);
  return { success: true };
}

export async function sendContract(id: string): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can send a contract." };

  const supabase = await getClient(profile.id);
  const { data: before } = await supabase
    .from("contracts")
    .select("status, created_by, project_id, token")
    .eq("id", id)
    .single();

  if (!before) return { error: "Contract not found." };
  if (before.created_by !== profile.id) return { error: "Not your contract." };
  if (before.status !== "draft") return { error: "Only drafts can be sent." };

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("contracts")
    .update({ status: "sent", sent_at: now, updated_at: now })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidateContract(before.project_id as string, id, before.token as string | null);
  return { success: true };
}

export async function deleteContract(id: string): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can delete a contract." };

  const supabase = await getClient(profile.id);
  const { data: before } = await supabase
    .from("contracts")
    .select("status, created_by, project_id")
    .eq("id", id)
    .single();

  if (!before) return { error: "Contract not found." };
  if (before.created_by !== profile.id) return { error: "Not your contract." };
  if (before.status !== "draft") return { error: "Only drafts can be deleted." };

  const { error } = await supabase.from("contracts").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(`/b/projects/${before.project_id as string}`);
  return { success: true };
}

export async function getContractsByProject(projectId: string): Promise<Contract[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];

  const supabase = await getClient(profile.id);
  const { data } = await supabase
    .from("contracts")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  return (data ?? []) as Contract[];
}

export async function getContractById(id: string): Promise<Contract | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const supabase = await getClient(profile.id);
  const { data } = await supabase.from("contracts").select("*").eq("id", id).maybeSingle();
  return (data ?? null) as Contract | null;
}
