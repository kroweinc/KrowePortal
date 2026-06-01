"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import type { Milestone, Brief, Task, MilestoneStatus } from "@/lib/types";

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : await createClient();
}

export interface MilestoneWithProgress extends Milestone {
  taskTotal: number;
  taskDone: number;
}

export async function getMilestonesForEngagement(
  engagementId: string
): Promise<MilestoneWithProgress[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];
  const supabase = await getClient(profile.id);

  const { data: milestones } = await supabase
    .from("milestones")
    .select("*")
    .eq("engagement_id", engagementId)
    .order("sort_order", { ascending: true });

  const list = (milestones ?? []) as Milestone[];
  if (list.length === 0) return [];

  const { data: tasks } = await supabase
    .from("tasks")
    .select("milestone_id, status")
    .eq("engagement_id", engagementId)
    .not("milestone_id", "is", null);

  const counts = new Map<string, { total: number; done: number }>();
  for (const t of (tasks ?? []) as { milestone_id: string; status: string }[]) {
    const c = counts.get(t.milestone_id) ?? { total: 0, done: 0 };
    c.total += 1;
    if (t.status === "done") c.done += 1;
    counts.set(t.milestone_id, c);
  }

  return list.map((m) => ({
    ...m,
    taskTotal: counts.get(m.id)?.total ?? 0,
    taskDone: counts.get(m.id)?.done ?? 0,
  }));
}

export async function getSignedQuoteForEngagement(engagementId: string): Promise<Brief | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const supabase = await getClient(profile.id);

  const { data } = await supabase
    .from("briefs")
    .select("*")
    .eq("engagement_id", engagementId)
    .eq("status", "signed")
    .order("signed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data ?? null) as Brief | null;
}

// Operator-visible task stream. RLS already filters to operator_visible
// rows for operators; builders see all. Ordered for milestone grouping.
export async function getEngagementTaskStream(engagementId: string): Promise<Task[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];
  const supabase = await getClient(profile.id);

  const { data } = await supabase
    .from("tasks")
    .select("*")
    .eq("engagement_id", engagementId)
    .order("sort_order", { ascending: true });

  return (data ?? []) as Task[];
}

// Recompute a milestone's status from its child tasks (all done => done;
// some progress => in_progress; otherwise pending).
export async function recomputeMilestoneStatus(
  id: string
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not authenticated." };
  const supabase = await getClient(profile.id);

  const { data: m } = await supabase
    .from("milestones")
    .select("id, status")
    .eq("id", id)
    .maybeSingle();
  if (!m) return { error: "Milestone not found." };

  const { data: tasks } = await supabase.from("tasks").select("status").eq("milestone_id", id);
  const list = (tasks ?? []) as { status: string }[];

  let status: MilestoneStatus = "pending";
  if (list.length > 0) {
    const done = list.filter((t) => t.status === "done").length;
    if (done === list.length) status = "done";
    else if (done > 0 || list.some((t) => t.status === "in_progress")) status = "in_progress";
  }

  if (status !== m.status) {
    await supabase
      .from("milestones")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id);
    revalidatePath("/o/project");
  }
  return { success: true };
}
