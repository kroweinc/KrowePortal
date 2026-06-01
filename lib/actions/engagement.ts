"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import type {
  BuilderAvailability,
  Deliverable,
  ContextMaterial,
  BusinessContextCard,
  EngagementAgreement,
  InfraRecommendation,
  PriorityKey,
  BusinessContextKind,
} from "@/lib/types";

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : await createClient();
}

function ok() {
  return { success: true } as const;
}

// ---------- Phase 7: Builder availability ----------

export async function getAvailability(engagementId: string): Promise<BuilderAvailability | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const supabase = await getClient(profile.id);
  const { data } = await supabase
    .from("builder_availability")
    .select("*")
    .eq("engagement_id", engagementId)
    .maybeSingle();
  return (data ?? null) as BuilderAvailability | null;
}

const availabilitySchema = z.object({
  status: z.enum(["available", "limited", "away"]),
  weeklyHours: z.number().int().min(0).max(168).nullable(),
  note: z.string().max(500).nullable(),
});

export async function setAvailability(
  engagementId: string,
  input: { status: "available" | "limited" | "away"; weeklyHours: number | null; note: string | null }
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can set availability." };
  const parsed = availabilitySchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid availability." };

  const supabase = await getClient(profile.id);
  const { error } = await supabase.from("builder_availability").upsert({
    engagement_id: engagementId,
    status: parsed.data.status,
    weekly_hours: parsed.data.weeklyHours,
    note: parsed.data.note,
    updated_at: new Date().toISOString(),
  });
  if (error) return { error: error.message };
  revalidatePath("/o/project");
  revalidatePath("/b/engagement");
  return ok();
}

// ---------- Phase 7: Deliverables thread ----------

export async function getDeliverables(engagementId: string): Promise<Deliverable[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];
  const supabase = await getClient(profile.id);
  const { data } = await supabase
    .from("deliverables")
    .select("*")
    .eq("engagement_id", engagementId)
    .order("created_at", { ascending: false });
  return (data ?? []) as Deliverable[];
}

const deliverableSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(2000).nullable(),
  url: z.string().url().max(1000).nullable().or(z.literal("").transform(() => null)),
  milestoneId: z.string().uuid().nullable(),
});

export async function postDeliverable(
  engagementId: string,
  input: { title: string; body: string | null; url: string | null; milestoneId: string | null }
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const parsed = deliverableSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid deliverable." };

  const supabase = await getClient(profile.id);
  const { error } = await supabase.from("deliverables").insert({
    engagement_id: engagementId,
    milestone_id: parsed.data.milestoneId,
    author_id: profile.id,
    title: parsed.data.title,
    body: parsed.data.body,
    url: parsed.data.url,
  });
  if (error) return { error: error.message };
  revalidatePath("/o/project");
  revalidatePath("/b/engagement");
  return ok();
}

export async function deleteDeliverable(id: string): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const supabase = await getClient(profile.id);
  const { error } = await supabase.from("deliverables").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/o/project");
  revalidatePath("/b/engagement");
  return ok();
}

// ---------- Phase 7: Operator context materials ----------

export async function getContextMaterials(engagementId: string): Promise<ContextMaterial[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];
  const supabase = await getClient(profile.id);
  const { data } = await supabase
    .from("context_materials")
    .select("*")
    .eq("engagement_id", engagementId)
    .order("created_at", { ascending: false });
  return (data ?? []) as ContextMaterial[];
}

const materialSchema = z.object({
  kind: z.enum(["link", "note"]),
  title: z.string().min(1).max(200),
  url: z.string().max(1000).nullable(),
  body: z.string().max(4000).nullable(),
  category: z.string().max(100).nullable(),
});

export async function addContextMaterial(
  engagementId: string,
  input: { kind: "link" | "note"; title: string; url: string | null; body: string | null; category: string | null }
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const parsed = materialSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid material." };

  const supabase = await getClient(profile.id);
  const { error } = await supabase.from("context_materials").insert({
    engagement_id: engagementId,
    kind: parsed.data.kind,
    title: parsed.data.title,
    url: parsed.data.url,
    body: parsed.data.body,
    category: parsed.data.category,
    uploaded_by: profile.id,
  });
  if (error) return { error: error.message };
  revalidatePath("/o/project");
  return ok();
}

export async function deleteContextMaterial(id: string): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const supabase = await getClient(profile.id);
  const { error } = await supabase.from("context_materials").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/o/project");
  return ok();
}

// ---------- Phase 7: Business context narratives ----------

export async function getBusinessContext(engagementId: string): Promise<BusinessContextCard[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];
  const supabase = await getClient(profile.id);
  const { data } = await supabase
    .from("business_context_cards")
    .select("*")
    .eq("engagement_id", engagementId);
  return (data ?? []) as BusinessContextCard[];
}

const businessContextSchema = z.object({
  kind: z.enum(["old_workflow", "problem"]),
  body: z.string().max(4000),
});

export async function upsertBusinessContext(
  engagementId: string,
  kind: BusinessContextKind,
  body: string
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const parsed = businessContextSchema.safeParse({ kind, body });
  if (!parsed.success) return { error: "Invalid input." };

  const supabase = await getClient(profile.id);
  const { error } = await supabase.from("business_context_cards").upsert({
    engagement_id: engagementId,
    kind: parsed.data.kind,
    body: parsed.data.body,
    updated_at: new Date().toISOString(),
  });
  if (error) return { error: error.message };
  revalidatePath("/o/project");
  return ok();
}

// ---------- Phase 8: Operating agreement ----------

export async function getAgreement(engagementId: string): Promise<EngagementAgreement | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const supabase = await getClient(profile.id);
  const { data } = await supabase
    .from("engagement_agreement")
    .select("*")
    .eq("engagement_id", engagementId)
    .maybeSingle();
  return (data ?? null) as EngagementAgreement | null;
}

const agreementSchema = z.object({
  warrantyDays: z.number().int().min(0).max(365),
  decisionRights: z
    .array(
      z.object({
        decision: z.string().max(200),
        signer: z.string().max(200),
        reviewer: z.string().max(200),
        informed: z.string().max(200),
      })
    )
    .max(20),
  reviewCadence: z.string().max(500).nullable(),
  meetingSchedule: z.string().max(500).nullable(),
  commChannels: z
    .array(z.object({ channel: z.string().max(100), purpose: z.string().max(300) }))
    .max(20),
  billingMode: z.enum(["fixed", "hourly"]),
  monthlyRecurring: z.number().min(0).nullable(),
  urgencyMultiplier: z.number().min(1).max(10),
});

export async function updateOperatingAgreement(
  engagementId: string,
  input: z.input<typeof agreementSchema>
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can edit the agreement." };
  const parsed = agreementSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid agreement." };

  const supabase = await getClient(profile.id);
  const { error } = await supabase.from("engagement_agreement").upsert({
    engagement_id: engagementId,
    warranty_days: parsed.data.warrantyDays,
    decision_rights: parsed.data.decisionRights,
    review_cadence: parsed.data.reviewCadence,
    meeting_schedule: parsed.data.meetingSchedule,
    comm_channels: parsed.data.commChannels,
    billing_mode: parsed.data.billingMode,
    monthly_recurring: parsed.data.monthlyRecurring,
    urgency_multiplier: parsed.data.urgencyMultiplier,
    updated_at: new Date().toISOString(),
  });
  if (error) return { error: error.message };
  revalidatePath("/o/project");
  revalidatePath("/b/engagement");
  return ok();
}

const priorityValues = ["quality", "speed", "cost", "security"] as const;
const prioritySchema = z.array(z.enum(priorityValues)).max(4);

export async function updatePriorityProfile(
  engagementId: string,
  priority: PriorityKey[]
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "operator") return { error: "Only the operator can set priorities." };
  const parsed = prioritySchema.safeParse(priority);
  if (!parsed.success) return { error: "Invalid priorities." };

  const supabase = await getClient(profile.id);
  const { error } = await supabase
    .from("engagement_agreement")
    .upsert({
      engagement_id: engagementId,
      priority_profile: parsed.data,
      updated_at: new Date().toISOString(),
    });
  if (error) return { error: error.message };
  revalidatePath("/o/project");
  revalidatePath("/b/engagement");
  return ok();
}

// ---------- Phase 9: Infra recommendations ----------

export async function getInfraRecommendations(engagementId: string): Promise<InfraRecommendation[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];
  const supabase = await getClient(profile.id);
  const { data } = await supabase
    .from("infra_recommendations")
    .select("*")
    .eq("engagement_id", engagementId)
    .order("created_at", { ascending: true });
  return (data ?? []) as InfraRecommendation[];
}

const infraSchema = z.object({
  category: z.string().max(100).nullable(),
  item: z.string().min(1).max(200),
  recommendedMonthly: z.number().min(0).nullable(),
});

export async function addInfraRecommendation(
  engagementId: string,
  input: { category: string | null; item: string; recommendedMonthly: number | null }
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can add recommendations." };
  const parsed = infraSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid recommendation." };

  const supabase = await getClient(profile.id);
  const { error } = await supabase.from("infra_recommendations").insert({
    engagement_id: engagementId,
    category: parsed.data.category,
    item: parsed.data.item,
    recommended_monthly: parsed.data.recommendedMonthly,
    created_by: profile.id,
  });
  if (error) return { error: error.message };
  revalidatePath("/o/project");
  revalidatePath("/b/engagement");
  return ok();
}

const overrideSchema = z.object({
  override: z.string().max(200).nullable(),
  overrideMonthly: z.number().min(0).nullable(),
  accepted: z.boolean(),
});

export async function setInfraOverride(
  id: string,
  input: { override: string | null; overrideMonthly: number | null; accepted: boolean }
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "operator") return { error: "Only the operator can override." };
  const parsed = overrideSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid override." };

  const supabase = await getClient(profile.id);
  const { error } = await supabase
    .from("infra_recommendations")
    .update({
      operator_override: parsed.data.override,
      operator_override_monthly: parsed.data.overrideMonthly,
      accepted: parsed.data.accepted,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/o/project");
  return ok();
}

export async function deleteInfraRecommendation(id: string): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can remove recommendations." };
  const supabase = await getClient(profile.id);
  const { error } = await supabase.from("infra_recommendations").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/o/project");
  revalidatePath("/b/engagement");
  return ok();
}
