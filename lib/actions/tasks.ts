"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { TaskStatus } from "@/lib/types";

const createTaskSchema = z.object({
  engagement_id: z.string().uuid(),
  title: z.string().min(1).max(300),
  description: z.string().optional(),
});

export async function createTask(formData: FormData) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = createTaskSchema.safeParse({
    engagement_id: formData.get("engagement_id"),
    title: formData.get("title"),
    description: formData.get("description") || undefined,
  });

  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.from("tasks").insert({
    engagement_id: parsed.data.engagement_id,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    source: profile.role === "operator" ? "operator_request" : "builder_added",
    created_by: profile.id,
  });

  if (error) return { error: error.message };

  revalidatePath(profile.role === "operator" ? "/o" : "/b");
  return { success: true };
}

const updateTaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(300).optional(),
  description: z.string().optional(),
  builder_estimate_hours: z.coerce.number().min(0).optional(),
});

export async function updateTask(formData: FormData) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = updateTaskSchema.safeParse({
    id: formData.get("id"),
    title: formData.get("title") || undefined,
    description: formData.get("description") || undefined,
    builder_estimate_hours: formData.get("builder_estimate_hours") || undefined,
  });

  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const { id, ...updates } = parsed.data;
  const { error } = await supabase
    .from("tasks")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath(profile.role === "operator" ? "/o" : "/b");
  return { success: true };
}

export async function updateTaskStatus(taskId: string, status: TaskStatus) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  const { error } = await supabase
    .from("tasks")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", taskId);

  if (error) return { error: error.message };

  revalidatePath("/b");
  return { success: true };
}

export async function toggleVisibility(taskId: string, visible: boolean) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "builder") redirect("/login");

  const supabase = await createClient();
  const { error } = await supabase
    .from("tasks")
    .update({ operator_visible: visible, updated_at: new Date().toISOString() })
    .eq("id", taskId);

  if (error) return { error: error.message };

  revalidatePath("/b");
  return { success: true };
}
