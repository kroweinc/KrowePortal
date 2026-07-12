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

function toRow(entry: AuditEntryInput) {
  return {
    task_id: entry.taskId,
    subtask_id: entry.subtaskId ?? null,
    actor_id: entry.actorId,
    action: entry.action,
    field: entry.field ?? null,
    old_value: entry.oldValue ?? null,
    new_value: entry.newValue ?? null,
    metadata: entry.metadata ?? null,
  };
}

export async function writeAuditEntry(entry: AuditEntryInput): Promise<void> {
  try {
    const supabase = await getClient(entry.actorId);
    await supabase.from("task_audit_log").insert(toRow(entry));
  } catch {
    // Audit-log failures must never break the underlying user action.
  }
}

/** Batch sibling of writeAuditEntry — one insert for N entries (same actor),
    so bulk task creation doesn't pay a DB round-trip per entry. */
export async function writeAuditEntries(entries: AuditEntryInput[]): Promise<void> {
  if (entries.length === 0) return;
  try {
    const supabase = await getClient(entries[0].actorId);
    await supabase.from("task_audit_log").insert(entries.map(toRow));
  } catch {
    // Audit-log failures must never break the underlying user action.
  }
}
