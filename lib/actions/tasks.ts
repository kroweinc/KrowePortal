"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { estimateAndSaveTaskHours } from "@/lib/actions/estimate-task";
import { writeAuditEntry } from "@/lib/actions/audit-log";
import type { TaskStatus, TaskPriority } from "@/lib/types";

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : createClient();
}

const createTaskSchema = z.object({
  engagement_id: z.string().uuid().optional(),
  title: z.string().min(1).max(300),
  description: z.string().optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
});

export async function createTask(formData: FormData) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const rawEngagementId = formData.get("engagement_id");
  const parsed = createTaskSchema.safeParse({
    engagement_id: rawEngagementId || undefined,
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    priority: formData.get("priority") || undefined,
  });

  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await getClient(profile.id);
  const { data, error } = await supabase.from("tasks").insert({
    engagement_id: parsed.data.engagement_id ?? null,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    priority: parsed.data.priority,
    source: profile.role === "operator" ? "operator_request" : "builder_added",
    created_by: profile.id,
  }).select("id").single();

  if (error) return { error: error.message };

  await writeAuditEntry({
    taskId: data.id as string,
    actorId: profile.id,
    action: "task.created",
    metadata: {
      title: parsed.data.title,
      source: profile.role === "operator" ? "operator_request" : "builder_added",
      priority: parsed.data.priority,
    },
  });

  // The AI hours estimate is a 1-3s OpenAI round-trip that self-persists to the
  // task row. Defer it past the response with after() so "Add task" returns
  // instantly; the estimate fills in on the next revalidation/navigation.
  const taskId = data.id as string;
  after(() =>
    estimateAndSaveTaskHours({
      taskId,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      priority: parsed.data.priority,
      userId: profile.id,
    })
  );

  revalidatePath(profile.role === "operator" ? "/o" : "/b");
  return { success: true, taskId };
}

const updateTaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(300).optional(),
  description: z.string().optional(),
  builder_estimate_hours: z.coerce.number().min(0).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
});

export async function updateTask(formData: FormData) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = updateTaskSchema.safeParse({
    id: formData.get("id"),
    title: formData.get("title") || undefined,
    description: formData.get("description") || undefined,
    builder_estimate_hours: formData.get("builder_estimate_hours") || undefined,
    priority: formData.get("priority") || undefined,
  });

  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await getClient(profile.id);
  const { id, ...updates } = parsed.data;

  const { data: before } = await supabase
    .from("tasks")
    .select("title, description, builder_estimate_hours, priority")
    .eq("id", id)
    .single();

  const { error } = await supabase
    .from("tasks")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { error: error.message };

  if (before) {
    // Write one audit entry per changed field — in parallel, not a serial loop,
    // so a multi-field edit doesn't stack several DB round-trips before returning.
    const changed = Object.entries(updates).filter(
      ([field, newValue]) => (before as Record<string, unknown>)[field] !== newValue
    );
    await Promise.all(
      changed.map(([field, newValue]) =>
        writeAuditEntry({
          taskId: id,
          actorId: profile.id,
          action: "task.field_changed",
          field,
          oldValue: (before as Record<string, unknown>)[field],
          newValue,
        })
      )
    );
  }

  revalidatePath(profile.role === "operator" ? "/o" : "/b");
  return { success: true };
}

const markDoneSchema = z.object({
  taskId: z.string().uuid(),
  pushed_to_main: z.boolean().default(false),
  completion_note: z.string().trim().max(2000).nullish(),
});

export async function markTaskDone(
  taskId: string,
  payload: { pushed_to_main: boolean; completion_note: string | null }
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = markDoneSchema.safeParse({ taskId, ...payload });
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await getClient(profile.id);

  const { data: before } = await supabase
    .from("tasks")
    .select("status")
    .eq("id", taskId)
    .single();

  const { error } = await supabase
    .from("tasks")
    .update({
      status: "done",
      pushed_to_main: parsed.data.pushed_to_main,
      completion_note: parsed.data.completion_note ?? null,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", taskId);

  if (error) return { error: error.message };

  if (before && before.status !== "done") {
    await writeAuditEntry({
      taskId,
      actorId: profile.id,
      action: "task.status_changed",
      field: "status",
      oldValue: before.status,
      newValue: "done",
    });
  }
  await writeAuditEntry({
    taskId,
    actorId: profile.id,
    action: "task.completed",
    metadata: {
      pushed_to_main: parsed.data.pushed_to_main,
      completion_note: parsed.data.completion_note ?? null,
    },
  });

  revalidatePath("/b");
  revalidatePath("/o");
  return { success: true };
}

const markForApprovalSchema = z.object({
  taskId: z.string().uuid(),
  note: z.string().trim().max(2000).nullish(),
});

export async function markTaskForApproval(
  taskId: string,
  payload: { note: string | null }
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = markForApprovalSchema.safeParse({ taskId, ...payload });
  if (!parsed.success) return { error: "Invalid input" };

  const now = new Date().toISOString();
  const updates: Record<string, string | null> = {
    status: "blocked",
    approval_sent_at: now,
    updated_at: now,
  };
  if (parsed.data.note) {
    updates.completion_note = parsed.data.note;
  }

  const supabase = await getClient(profile.id);

  const { data: before } = await supabase
    .from("tasks")
    .select("status")
    .eq("id", taskId)
    .single();

  const { error } = await supabase.from("tasks").update(updates).eq("id", taskId);

  if (error) return { error: error.message };

  if (before && before.status !== "blocked") {
    await writeAuditEntry({
      taskId,
      actorId: profile.id,
      action: "task.status_changed",
      field: "status",
      oldValue: before.status,
      newValue: "blocked",
    });
  }
  await writeAuditEntry({
    taskId,
    actorId: profile.id,
    action: "task.sent_for_approval",
    metadata: parsed.data.note ? { note: parsed.data.note } : null,
  });

  revalidatePath("/b");
  revalidatePath("/o");
  return { success: true };
}

// Operator sign-off on a task that the builder sent for approval. Orthogonal to
// the Done transition — it only stamps approval_approved_at; the builder still
// advances the task to Done separately.
export async function approveTask(
  taskId: string
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "operator") return { error: "Only operators can approve tasks." };

  const supabase = await getClient(profile.id);

  const { data: before } = await supabase
    .from("tasks")
    .select("approval_sent_at, approval_approved_at")
    .eq("id", taskId)
    .single();

  if (!before) return { error: "Task not found." };
  if (!before.approval_sent_at) return { error: "Task has not been sent for approval." };
  if (before.approval_approved_at) return { success: true };

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("tasks")
    .update({ approval_approved_at: now, updated_at: now })
    .eq("id", taskId);

  if (error) return { error: error.message };

  await writeAuditEntry({
    taskId,
    actorId: profile.id,
    action: "task.approved",
  });

  revalidatePath("/b");
  revalidatePath("/o");
  return { success: true };
}

export async function updateTaskStatus(taskId: string, status: TaskStatus) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await getClient(profile.id);

  const { data: before } = await supabase
    .from("tasks")
    .select("status")
    .eq("id", taskId)
    .single();

  const { error } = await supabase
    .from("tasks")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", taskId);

  if (error) return { error: error.message };

  if (before && before.status !== status) {
    await writeAuditEntry({
      taskId,
      actorId: profile.id,
      action: "task.status_changed",
      field: "status",
      oldValue: before.status,
      newValue: status,
    });
  }

  revalidatePath("/b");
  revalidatePath("/o");
  return { success: true };
}

export async function reorderTask(taskId: string, sortOrder: number) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await getClient(profile.id);
  const { error } = await supabase
    .from("tasks")
    .update({ sort_order: sortOrder, updated_at: new Date().toISOString() })
    .eq("id", taskId);

  if (error) return { error: error.message };
  revalidatePath("/b");
  return { success: true };
}

export async function deleteTask(taskId: string) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await getClient(profile.id);

  // Gather attachment files before the row cascade: FK ON DELETE CASCADE removes
  // task_attachments rows but never the underlying storage objects (see
  // deleteAttachment for the per-file pattern), which would leak files forever.
  const { data: files } = await supabase
    .from("task_attachments")
    .select("storage_path")
    .eq("task_id", taskId)
    .not("storage_path", "is", null);

  const { error } = await supabase.from("tasks").delete().eq("id", taskId);

  if (error) return { error: error.message };

  const paths = (files ?? []).map((f) => f.storage_path as string).filter(Boolean);
  if (paths.length) {
    await createAdminClient().storage.from("task-attachments").remove(paths);
  }

  revalidatePath("/o");
  revalidatePath("/b");
  return { success: true };
}
