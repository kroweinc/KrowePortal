"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { notifyUser, changeOrderSignedEmail } from "@/lib/email/notify";
import type { ChangeOrder, ChangeOrderContent } from "@/lib/types";

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : await createClient();
}

const DEFAULT_RATE = 200; // nuisance change-order rate per pricing-model research

function computeTotal(content: ChangeOrderContent): number {
  const rate = content.hourlyRate ?? DEFAULT_RATE;
  const items = content.lineItems ?? [];
  return items.reduce((sum, li) => {
    const amount = li.amount || Math.round((li.hours ?? 0) * rate);
    return sum + amount;
  }, 0);
}

export async function getChangeOrders(engagementId: string): Promise<ChangeOrder[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];
  const supabase = await getClient(profile.id);
  const { data } = await supabase
    .from("change_orders")
    .select("*")
    .eq("engagement_id", engagementId)
    .order("created_at", { ascending: false });
  return (data ?? []) as ChangeOrder[];
}

const contentSchema = z.object({
  summary: z.string().max(2000).optional(),
  lineItems: z
    .array(
      z.object({
        label: z.string().max(200),
        hours: z.number().min(0).nullable().optional(),
        amount: z.number().min(0),
        notes: z.string().max(500).nullable().optional(),
      })
    )
    .max(50)
    .optional(),
  hourlyRate: z.number().min(0).optional(),
  total: z.number().min(0).optional(),
});

const createSchema = z.object({
  title: z.string().min(1).max(200),
  content: contentSchema,
});

export async function createChangeOrder(
  engagementId: string,
  input: { title: string; content: ChangeOrderContent }
): Promise<{ success: true; id: string } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can create change orders." };
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid change order." };

  const total = computeTotal(parsed.data.content as ChangeOrderContent);
  const supabase = await getClient(profile.id);
  const { data, error } = await supabase
    .from("change_orders")
    .insert({
      engagement_id: engagementId,
      title: parsed.data.title,
      content: { ...parsed.data.content, total },
      delta_amount: total,
      status: "draft",
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Failed to create change order." };
  revalidatePath(`/b/engagements/${engagementId}`);
  return { success: true, id: data.id as string };
}

export async function updateChangeOrder(
  id: string,
  input: { title?: string; content?: ChangeOrderContent }
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can edit change orders." };

  const supabase = await getClient(profile.id);
  const { data: before } = await supabase
    .from("change_orders")
    .select("status, created_by")
    .eq("id", id)
    .single();
  if (!before) return { error: "Change order not found." };
  if (before.status !== "draft") return { error: "Only drafts can be edited." };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.content !== undefined) {
    const total = computeTotal(input.content);
    patch.content = { ...input.content, total };
    patch.delta_amount = total;
  }
  const { error } = await supabase.from("change_orders").update(patch).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/b/engagements");
  return { success: true };
}

export async function sendChangeOrder(id: string): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can send change orders." };
  const supabase = await getClient(profile.id);
  const { data: before } = await supabase.from("change_orders").select("status").eq("id", id).single();
  if (!before) return { error: "Change order not found." };
  if (before.status !== "draft") return { error: "Only drafts can be sent." };
  const { error } = await supabase
    .from("change_orders")
    .update({ status: "sent", updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/b/engagements");
  revalidatePath("/o/project");
  return { success: true };
}

export async function rejectChangeOrder(
  id: string,
  note: string | null
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "operator") return { error: "Only the operator can reject change orders." };
  const supabase = await getClient(profile.id);
  const { data: before } = await supabase.from("change_orders").select("status").eq("id", id).single();
  if (!before) return { error: "Change order not found." };
  if (before.status !== "sent") return { error: "Change order is not awaiting a decision." };
  const { error } = await supabase
    .from("change_orders")
    .update({
      status: "rejected",
      rejected_at: new Date().toISOString(),
      rejection_note: note?.slice(0, 2000) ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/b/engagements");
  revalidatePath("/o/project");
  return { success: true };
}

const signSchema = z.object({
  signerName: z.string().trim().min(2).max(200),
  consent: z.literal(true),
});

// Operator signs a sent change order from their (authenticated) dashboard.
// Appends a milestone + tasks atomically via the sign_change_order RPC.
export async function signChangeOrder(
  id: string,
  input: { signerName: string; consent: boolean }
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "operator") return { error: "Only the operator can sign change orders." };
  const parsed = signSchema.safeParse(input);
  if (!parsed.success) return { error: "Type your name and agree to the terms to sign." };

  const supabase = await getClient(profile.id);
  const { data: co } = await supabase
    .from("change_orders")
    .select("id, status, title, content, delta_amount, engagement_id")
    .eq("id", id)
    .single();
  if (!co) return { error: "Change order not found." };
  if (co.status !== "sent") return { error: "Change order is not awaiting signature." };

  const content = (co.content ?? {}) as ChangeOrderContent;
  const tasks = (content.lineItems ?? [])
    .map((li) => li.label?.trim())
    .filter((t): t is string => !!t);

  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim() || null;

  const { error } = await supabase.rpc("sign_change_order", {
    p_change_order_id: id,
    p_signer_name: parsed.data.signerName,
    p_signer_ip: ip,
    p_milestone_title: `Change order: ${co.title as string}`,
    p_tasks: tasks,
    p_delta_amount: (co.delta_amount as number | null) ?? content.total ?? 0,
  });
  if (error) return { error: error.message };

  // Notify the builder their change order was signed. Look up the engagement's
  // builder via the admin client (recipient ≠ actor — the operator signed).
  const engagementId = co.engagement_id as string;
  const admin = createAdminClient();
  const { data: eng } = await admin
    .from("engagements")
    .select("builder_id")
    .eq("id", engagementId)
    .maybeSingle();
  if (eng?.builder_id) {
    const coEmail = changeOrderSignedEmail({
      title: co.title as string,
      signerName: parsed.data.signerName,
      engagementId,
    });
    void notifyUser({ userId: eng.builder_id as string, type: "change_order", ...coEmail });
  }

  revalidatePath("/o/project");
  revalidatePath("/b/engagements");
  return { success: true };
}
