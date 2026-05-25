"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { DEV_PROFILE_IDS } from "@/lib/auth";

export type AuditEntryInput = {
  taskId: string;
  subtaskId?: string | null;
  actorId: string;
  action: string;
  field?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  metadata?: Record<string, unknown> | null;
};

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : createClient();
}

export async function writeAuditEntry(entry: AuditEntryInput): Promise<void> {
  try {
    const supabase = await getClient(entry.actorId);
    await supabase.from("task_audit_log").insert({
      task_id: entry.taskId,
      subtask_id: entry.subtaskId ?? null,
      actor_id: entry.actorId,
      action: entry.action,
      field: entry.field ?? null,
      old_value: entry.oldValue ?? null,
      new_value: entry.newValue ?? null,
      metadata: entry.metadata ?? null,
    });
  } catch {
    // Audit-log failures must never break the underlying user action.
  }
}
