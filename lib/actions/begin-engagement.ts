"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { createInvitation } from "@/lib/actions/invitations";
import { seedEngagementTasksFromQuote } from "@/lib/project/provision";
import { derivePipeline, type ProjectPipeline } from "@/lib/project/stage";
import type { DocStatus, Engagement, Quote } from "@/lib/types";

// The engagement started from this project (0 or 1 — enforced by the
// engagements_project_unique partial index).
export async function getEngagementByProject(projectId: string): Promise<Engagement | null> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "builder") return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("engagements")
    .select("*")
    .eq("project_id", projectId)
    .eq("builder_id", profile.id)
    .maybeSingle();

  return (data ?? null) as Engagement | null;
}

// Newest signed/accepted quote on the project — the source for task seeding.
export async function getSignedQuoteForProject(projectId: string): Promise<Quote | null> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "builder") return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("quotes")
    .select("*")
    .eq("project_id", projectId)
    .in("status", ["signed", "accepted"])
    .order("signed_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  return (data ?? null) as Quote | null;
}

// Pipeline stage per project for the projects list — 4 batched queries total
// regardless of how many projects are shown.
export async function getProjectStages(
  projectIds: string[]
): Promise<Record<string, ProjectPipeline>> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "builder" || projectIds.length === 0) return {};

  const admin = createAdminClient();
  const [prdRows, quoteRows, contractRows, engagementRows] = await Promise.all([
    admin.from("prds").select("project_id, status").in("project_id", projectIds),
    admin.from("quotes").select("project_id, status").in("project_id", projectIds),
    admin.from("contracts").select("project_id, status").in("project_id", projectIds),
    admin
      .from("engagements")
      .select("id, project_id, started_at")
      .in("project_id", projectIds)
      .eq("builder_id", profile.id),
  ]);

  const byProject = (rows: { project_id: string; status: string }[] | null) => {
    const map: Record<string, { status: string }[]> = {};
    for (const row of rows ?? []) (map[row.project_id] ??= []).push({ status: row.status });
    return map;
  };
  const prds = byProject(prdRows.data as { project_id: string; status: string }[] | null);
  const quotes = byProject(quoteRows.data as { project_id: string; status: string }[] | null);
  const contracts = byProject(contractRows.data as { project_id: string; status: string }[] | null);
  const engagements = new Map(
    ((engagementRows.data ?? []) as {
      id: string;
      project_id: string;
      started_at: string | null;
    }[]).map((e) => [e.project_id, { id: e.id, started_at: e.started_at }])
  );

  const result: Record<string, ProjectPipeline> = {};
  for (const id of projectIds) {
    result[id] = derivePipeline({
      prds: (prds[id] ?? []) as { status: DocStatus }[],
      quotes: (quotes[id] ?? []) as { status: Quote["status"] }[],
      contracts: (contracts[id] ?? []) as { status: DocStatus }[],
      engagement: engagements.get(id) ?? null,
    });
  }
  return result;
}

const beginSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1).max(120),
  seedTasks: z.boolean(),
  createInvite: z.boolean(),
});

export type BeginEngagementInput = z.input<typeof beginSchema>;

export type BeginEngagementResult =
  | {
      engagementId: string;
      inviteToken: string | null;
      seededMilestones: number;
      seededTasks: number;
    }
  | { error: string };

/**
 * Turns a project into a live engagement: creates the engagement linked to
 * the project, optionally seeds milestones + tasks from the newest signed
 * quote, and optionally mints an invite link for the prospect.
 */
export async function beginEngagement(input: BeginEngagementInput): Promise<BeginEngagementResult> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders can begin clients." };

  const parsed = beginSchema.safeParse(input);
  if (!parsed.success) return { error: "Client name must be 1–120 characters." };
  const { projectId, title, seedTasks, createInvite } = parsed.data;

  // Admin client throughout — ownership is verified explicitly below.
  const admin = createAdminClient();

  const { data: project } = await admin
    .from("projects")
    .select("id, owner_id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project || project.owner_id !== profile.id) return { error: "Document not found." };

  const now = new Date().toISOString();

  // A shell may already exist from an operator accepting a doc (PRD/quote) —
  // linkOperatorToProject creates one without started_at. Beginning the
  // engagement means stamping started_at; only an already-started engagement
  // is a no-op error.
  const { data: existing } = await admin
    .from("engagements")
    .select("id, started_at")
    .eq("project_id", projectId)
    .maybeSingle();

  let engagement: { id: string };
  if (existing) {
    if (existing.started_at) {
      return { error: "A client was already started for this document." };
    }
    const { data: started, error: startErr } = await admin
      .from("engagements")
      .update({ started_at: now, title: title.trim() })
      .eq("id", existing.id)
      .select("id")
      .single();
    if (startErr || !started) return { error: startErr?.message ?? "Failed to begin client." };
    engagement = started as { id: string };
  } else {
    const { data: created, error: engErr } = await admin
      .from("engagements")
      .insert({ builder_id: profile.id, title: title.trim(), project_id: projectId, started_at: now })
      .select("id")
      .single();

    if (engErr || !created) {
      // 23505 = unique violation on engagements_project_unique (double-click race)
      if (engErr?.code === "23505") {
        return { error: "A client was already started for this document." };
      }
      return { error: engErr?.message ?? "Failed to create client." };
    }
    engagement = created as { id: string };
  }

  let seededMilestones = 0;
  let seededTasks = 0;

  if (seedTasks) {
    const quote = await getSignedQuoteForProject(projectId);
    if (quote) {
      const seeded = await seedEngagementTasksFromQuote(admin, engagement.id, quote, profile.id);
      seededMilestones = seeded.milestones;
      seededTasks = seeded.tasks;
    }
  }

  let inviteToken: string | null = null;
  if (createInvite) {
    const invite = await createInvitation(engagement.id);
    if ("token" in invite) inviteToken = invite.token;
  }

  revalidatePath(`/b/projects/${projectId}`);
  revalidatePath("/b/projects");
  revalidatePath("/b/engagements");
  revalidatePath("/b");

  return { engagementId: engagement.id as string, inviteToken, seededMilestones, seededTasks };
}
