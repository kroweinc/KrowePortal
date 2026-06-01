"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { getProjectById } from "@/lib/actions/projects";
import { getPrdsByProject } from "@/lib/actions/prds";
import { generateBriefDraft } from "@/lib/ai/generate-brief-draft";
import { parseSopNotes, sopIntakeToBriefIntake } from "@/lib/ai/parse-sop-notes";
import type { Brief, BriefContent, PrdContent, SopIntake } from "@/lib/types";

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : await createClient();
}

// The quote should price what the PRD promises. Prefer a signed PRD, then the
// most recent sent one, then the latest draft. Returns undefined if the
// project has no PRD yet (the quote then drafts from discovery notes alone).
async function bestPrdContent(projectId: string): Promise<PrdContent | undefined> {
  const prds = await getPrdsByProject(projectId);
  if (prds.length === 0) return undefined;
  const signed = prds.find((p) => p.status === "signed");
  const sent = prds.find((p) => p.status === "sent");
  return (signed ?? sent ?? prds[0]).content;
}

// Briefs render in two places depending on their parent: the legacy
// engagement views (/b/brief, /o/brief) and the outbound project quote
// views (/b/projects/[id]/quote/[id]). Refresh whichever applies, plus
// the public token page if the quote has been sent.
function revalidateBrief(opts: {
  id: string;
  projectId?: string | null;
  engagementId?: string | null;
  token?: string | null;
}) {
  if (opts.projectId) {
    revalidatePath(`/b/projects/${opts.projectId}`);
    revalidatePath(`/b/projects/${opts.projectId}/quote/${opts.id}`);
  }
  if (opts.engagementId !== undefined && opts.engagementId !== null) {
    revalidatePath(`/b/brief/${opts.id}`);
    revalidatePath(`/o/brief/${opts.id}`);
    revalidatePath("/b/brief");
  }
  if (opts.token) revalidatePath(`/quote/${opts.token}`);
}

const intakeSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1).max(200),
  clientName: z.string().max(200).optional(),
  rawNotes: z.string().min(1, "Paste your discovery-call notes.").max(20000),
});

export async function createBriefDraft(
  formData: FormData
): Promise<{ error: string } | void> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders can create quotes." };

  const parsed = intakeSchema.safeParse({
    projectId: formData.get("projectId"),
    title: formData.get("title"),
    clientName: formData.get("clientName") || undefined,
    rawNotes: formData.get("rawNotes"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid intake input." };
  }

  // The quote is an outbound document hanging off a builder-owned project.
  const project = await getProjectById(parsed.data.projectId);
  if (!project) return { error: "Project not found." };
  if (project.owner_id !== profile.id) return { error: "Not your project." };

  const supabase = await getClient(profile.id);

  // 1. Parse the raw discovery notes into structured SOP fields.
  const sopIntake = await parseSopNotes(parsed.data.rawNotes);

  // 2. Draft the quote from those fields, aligned to the project's PRD if one exists.
  const prdContent = await bestPrdContent(parsed.data.projectId);
  const content = await generateBriefDraft({
    title: parsed.data.title,
    intake: sopIntakeToBriefIntake(sopIntake, parsed.data.clientName ?? project.prospect_name ?? undefined),
    prdContent,
  });

  const { data, error } = await supabase
    .from("briefs")
    .insert({
      project_id: parsed.data.projectId,
      created_by: profile.id,
      title: parsed.data.title,
      status: "draft",
      sop_intake: sopIntake,
      content,
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Failed to create quote." };

  revalidatePath(`/b/projects/${parsed.data.projectId}`);
  redirect(`/b/projects/${parsed.data.projectId}/quote/${data.id as string}`);
}

const reparseSchema = z.object({
  id: z.string().uuid(),
  rawNotes: z.string().min(1, "Paste your discovery-call notes.").max(20000),
});

// Re-run SOP parsing on an existing brief (e.g. the builder pasted more
// notes after the call). Re-drafts the quote content from the fresh fields.
// Allowed for any non-accepted brief; status is preserved in place.
export async function reparseSopIntake(
  id: string,
  rawNotes: string
): Promise<{ success: true; sopIntake: SopIntake; content: BriefContent } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can edit a brief." };

  const parsed = reparseSchema.safeParse({ id, rawNotes });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await getClient(profile.id);

  const { data: before } = await supabase
    .from("briefs")
    .select("status, created_by, title, project_id, engagement_id, token")
    .eq("id", id)
    .single();

  if (!before) return { error: "Brief not found." };
  if (before.created_by !== profile.id) return { error: "Not your brief." };
  if (before.status === "accepted") return { error: "Accepted briefs can't be edited." };

  const sopIntake = await parseSopNotes(parsed.data.rawNotes);
  const prdContent = before.project_id
    ? await bestPrdContent(before.project_id as string)
    : undefined;
  const content = await generateBriefDraft({
    title: before.title as string,
    intake: sopIntakeToBriefIntake(sopIntake),
    prdContent,
  });

  const { error } = await supabase
    .from("briefs")
    .update({ sop_intake: sopIntake, content, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidateBrief({ id, projectId: before.project_id, engagementId: before.engagement_id, token: before.token });
  return { success: true, sopIntake, content };
}

const updateContentSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  content: z.record(z.string(), z.unknown()).optional(),
  sopIntake: z.record(z.string(), z.unknown()).optional(),
});

export async function updateBriefContent(
  id: string,
  updates: { title?: string; content?: BriefContent; sopIntake?: SopIntake }
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can edit a brief." };

  const parsed = updateContentSchema.safeParse({
    id,
    title: updates.title,
    content: updates.content as Record<string, unknown> | undefined,
    sopIntake: updates.sopIntake as Record<string, unknown> | undefined,
  });
  if (!parsed.success) return { error: "Invalid input." };

  const supabase = await getClient(profile.id);

  const { data: before } = await supabase
    .from("briefs")
    .select("status, created_by, token, project_id, engagement_id")
    .eq("id", id)
    .single();

  if (!before) return { error: "Brief not found." };
  if (before.created_by !== profile.id) return { error: "Not your brief." };
  if (before.status === "accepted") return { error: "Accepted briefs can't be edited." };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.content !== undefined) patch.content = parsed.data.content;
  if (parsed.data.sopIntake !== undefined) patch.sop_intake = parsed.data.sopIntake;

  const { error } = await supabase.from("briefs").update(patch).eq("id", id);
  if (error) return { error: error.message };

  revalidateBrief({ id, projectId: before.project_id, engagementId: before.engagement_id, token: before.token });
  return { success: true };
}

export async function sendBrief(
  id: string
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can send a brief." };

  const supabase = await getClient(profile.id);

  const { data: before } = await supabase
    .from("briefs")
    .select("status, created_by, project_id, engagement_id, token")
    .eq("id", id)
    .single();

  if (!before) return { error: "Brief not found." };
  if (before.created_by !== profile.id) return { error: "Not your brief." };
  if (before.status !== "draft") return { error: "Only drafts can be sent." };

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("briefs")
    .update({ status: "sent", sent_at: now, updated_at: now })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidateBrief({ id, projectId: before.project_id, engagementId: before.engagement_id, token: before.token });
  return { success: true };
}

export async function acceptBrief(
  id: string
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "operator") return { error: "Only the operator can accept a brief." };

  const supabase = await getClient(profile.id);

  const { data: before } = await supabase
    .from("briefs")
    .select("status, engagement_id")
    .eq("id", id)
    .single();

  if (!before) return { error: "Brief not found." };

  // IDOR guard: confirm this operator owns the brief's engagement, not just
  // that they hold the operator role.
  const { data: engagement } = await supabase
    .from("engagements")
    .select("operator_id")
    .eq("id", before.engagement_id)
    .single();
  if (!engagement || engagement.operator_id !== profile.id) {
    return { error: "Not your engagement." };
  }

  if (before.status !== "sent") return { error: "Brief is not awaiting acceptance." };

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("briefs")
    .update({
      status: "accepted",
      accepted_at: now,
      accepted_by: profile.id,
      updated_at: now,
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath(`/o/brief/${id}`);
  revalidatePath(`/b/brief/${id}`);
  revalidatePath("/b/brief");
  return { success: true };
}

const rejectSchema = z.object({
  id: z.string().uuid(),
  note: z.string().trim().max(2000).nullish(),
});

export async function rejectBrief(
  id: string,
  note: string | null
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "operator") return { error: "Only the operator can reject a brief." };

  const parsed = rejectSchema.safeParse({ id, note });
  if (!parsed.success) return { error: "Invalid input." };

  const supabase = await getClient(profile.id);

  const { data: before } = await supabase
    .from("briefs")
    .select("status, engagement_id")
    .eq("id", id)
    .single();

  if (!before) return { error: "Brief not found." };

  // IDOR guard: confirm this operator owns the brief's engagement, not just
  // that they hold the operator role.
  const { data: engagement } = await supabase
    .from("engagements")
    .select("operator_id")
    .eq("id", before.engagement_id)
    .single();
  if (!engagement || engagement.operator_id !== profile.id) {
    return { error: "Not your engagement." };
  }

  if (before.status !== "sent") return { error: "Brief is not awaiting a decision." };

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("briefs")
    .update({
      status: "rejected",
      rejected_at: now,
      rejection_note: parsed.data.note ?? null,
      updated_at: now,
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath(`/o/brief/${id}`);
  revalidatePath(`/b/brief/${id}`);
  revalidatePath("/b/brief");
  return { success: true };
}

export async function deleteBrief(
  id: string
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can delete a brief." };

  const supabase = await getClient(profile.id);

  const { data: before } = await supabase
    .from("briefs")
    .select("status, created_by, project_id, engagement_id")
    .eq("id", id)
    .single();

  if (!before) return { error: "Brief not found." };
  if (before.created_by !== profile.id) return { error: "Not your brief." };
  if (before.status !== "draft") return { error: "Only drafts can be deleted." };

  const { error } = await supabase.from("briefs").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidateBrief({ id, projectId: before.project_id, engagementId: before.engagement_id });
  return { success: true };
}

export async function getBriefs(): Promise<Brief[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];

  const supabase = await getClient(profile.id);
  const { data } = await supabase
    .from("briefs")
    .select("*")
    .order("created_at", { ascending: false });

  return (data ?? []) as Brief[];
}

// Outbound quotes for a single project (used by the project detail page).
export async function getBriefsByProject(projectId: string): Promise<Brief[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];

  const supabase = await getClient(profile.id);
  const { data } = await supabase
    .from("briefs")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  return (data ?? []) as Brief[];
}

export async function getBriefById(id: string): Promise<Brief | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const supabase = await getClient(profile.id);
  const { data } = await supabase
    .from("briefs")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  return (data ?? null) as Brief | null;
}
