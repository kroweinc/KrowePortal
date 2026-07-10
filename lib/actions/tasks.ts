"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { estimateAndSaveTaskHours } from "@/lib/actions/estimate-task";
import { classifyAndSaveTask } from "@/lib/actions/classify-task";
import { writeAuditEntry, writeAuditEntries, type AuditEntryInput } from "@/lib/actions/audit-log";
import { isTaskMember } from "@/lib/actions/task-access";
import { getMyEngagements } from "@/lib/actions/invitations";
import { getEngagementRepoById } from "@/lib/github/engagement-repo";
import { getMergedPrSha, isNewMerge } from "@/lib/github/merged-prs";
import { isUniqueViolation } from "@/lib/supabase/errors";
import { findSimilarTitles } from "@/lib/tasks/dedupe";
import { TASK_TAGS, type TaskStatus, type TaskTag } from "@/lib/types";

async function getClient(profileId: string) {
  return DEV_PROFILE_IDS.has(profileId) ? createAdminClient() : createClient();
}

const createTaskSchema = z.object({
  engagement_id: z.string().uuid().optional(),
  title: z.string().min(1).max(300),
  description: z.string().optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  // Optional Linear-style classification, supplied pre-classified by the AI draft
  // flow (new-task-form). Absent on manual entry, which classifies after creation.
  type: z.enum(["feature", "bug", "change"]).optional(),
  tags: z.array(z.enum(TASK_TAGS)).max(1).optional(),
  // Optional starting column, from the Granola review's "Lands in" select.
  // Done is excluded so a freshly created task can't bypass the approval gate.
  status: z.enum(["backlog", "todo", "in_progress"]).optional(),
  // Per-form idempotency key (crypto.randomUUID). A retried/double-fired submit
  // reuses it, so the unique index collapses it to the same task instead of a
  // second row. Absent on non-browser callers, which simply skip idempotency.
  client_request_id: z.string().uuid().optional(),
});

export async function createTask(formData: FormData) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  // tags arrive as a JSON-encoded array from the AI draft form; parse leniently.
  const rawTags = formData.get("tags");
  let tags: unknown = undefined;
  if (typeof rawTags === "string" && rawTags) {
    try {
      tags = JSON.parse(rawTags);
    } catch {
      tags = undefined;
    }
  }

  const rawEngagementId = formData.get("engagement_id");
  const parsed = createTaskSchema.safeParse({
    engagement_id: rawEngagementId || undefined,
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    priority: formData.get("priority") || undefined,
    type: formData.get("type") || undefined,
    tags,
    status: formData.get("status") || undefined,
    client_request_id: formData.get("client_request_id") || undefined,
  });

  if (!parsed.success) return { error: "Invalid input" };

  // "Create anyway" from the near-duplicate warning below re-submits with this
  // set, bypassing the check so a legitimately-distinct task is never blocked.
  const confirmDuplicate = formData.get("confirm_duplicate") === "true";

  const supabase = await getClient(profile.id);

  // Near-duplicate warn (engagement-scoped only): surface an existing OPEN task
  // that looks like this one and let the caller decide, rather than silently
  // creating a second copy. Skipped for personal tasks (no engagement scope).
  if (parsed.data.engagement_id && !confirmDuplicate) {
    const { data: openTasks } = await supabase
      .from("tasks")
      .select("id, title, status")
      .eq("engagement_id", parsed.data.engagement_id)
      .neq("status", "done");
    const matches = findSimilarTitles(
      parsed.data.title,
      (openTasks ?? []).map((t) => ({ id: t.id as string, title: t.title as string }))
    );
    if (matches.length > 0) {
      return { duplicateWarning: matches.map((m) => ({ id: m.id, title: m.title })) };
    }
  }

  const { data, error } = await supabase.from("tasks").insert({
    engagement_id: parsed.data.engagement_id ?? null,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    priority: parsed.data.priority,
    // Pre-classified by the AI draft; null/[] on manual entry (filled by the
    // deferred classifier below).
    type: parsed.data.type ?? null,
    tags: parsed.data.tags ?? [],
    source: profile.role === "operator" ? "operator_request" : "builder_added",
    created_by: profile.id,
    // Omit when unset so the column's DB default applies.
    ...(parsed.data.status ? { status: parsed.data.status } : {}),
    // Idempotency key — a retry with the same key hits the partial unique index
    // (migration 0075) and resolves to the already-created task below.
    ...(parsed.data.client_request_id ? { client_request_id: parsed.data.client_request_id } : {}),
  }).select("id").single();

  if (error) {
    // A double-submit lost the race: the first insert already created the task.
    // Return it as success so the retry is a no-op, not a duplicate or an error.
    if (isUniqueViolation(error) && parsed.data.client_request_id) {
      const { data: existing } = await supabase
        .from("tasks")
        .select("id")
        .eq("client_request_id", parsed.data.client_request_id)
        .maybeSingle();
      if (existing) {
        return { success: true, taskId: existing.id as string, deduped: true };
      }
    }
    return { error: error.message };
  }

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

  // The AI hours estimate is an OpenAI round-trip that self-persists to the task
  // row. Defer it past the response with after() so "Add task" returns instantly;
  // it fills in on the next revalidation/navigation.
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
  // Type/tags are classified inline during AI draft generation and inserted above,
  // so a drafted task is already classified. Only manual entries (no type supplied)
  // need the deferred classifier pass.
  if (!parsed.data.type) {
    after(() =>
      classifyAndSaveTask({
        taskId,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        userId: profile.id,
      })
    );
  }

  revalidatePath(profile.role === "operator" ? "/o" : "/b");
  return { success: true, taskId };
}

const updateTaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(300).optional(),
  description: z.string().optional(),
  builder_estimate_hours: z.coerce.number().min(0).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  type: z.enum(["feature", "bug", "change"]).optional(),
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
    type: formData.get("type") || undefined,
  });

  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await getClient(profile.id);
  const { id, ...updates } = parsed.data;
  if (!(await isTaskMember(id, profile.id)))
    return { error: "You don't have access to this task." };

  const { data: before } = await supabase
    .from("tasks")
    .select("title, description, builder_estimate_hours, priority, type")
    .eq("id", id)
    .single();

  // A manual estimate edit collapses the AI range onto the entered midpoint, so
  // the detail view — which prefers low/high over the midpoint — reads back
  // exactly what was typed instead of a stale AI range. Kept out of `updates` so
  // the audit loop below still logs a single "estimate" change, not three.
  const patch: Record<string, unknown> = {
    ...updates,
    updated_at: new Date().toISOString(),
  };
  if (updates.builder_estimate_hours != null) {
    patch.builder_estimate_low_hours = updates.builder_estimate_hours;
    patch.builder_estimate_high_hours = updates.builder_estimate_hours;
  }

  const { error } = await supabase
    .from("tasks")
    .update(patch)
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
  // The feature branch this work lives on — used to group done tasks on
  // /b/staging. Empty string coerces to null so "no branch picked" is stored
  // consistently.
  branch_name: z.string().trim().max(200).nullish(),
});

export async function markTaskDone(
  taskId: string,
  payload: {
    pushed_to_main: boolean;
    completion_note: string | null;
    branch_name?: string | null;
  }
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = markDoneSchema.safeParse({ taskId, ...payload });
  if (!parsed.success) return { error: "Invalid input" };
  if (!(await isTaskMember(taskId, profile.id)))
    return { error: "You don't have access to this task." };

  const branchName = parsed.data.branch_name?.trim() || null;

  const supabase = await getClient(profile.id);

  const { data: before } = await supabase
    .from("tasks")
    .select("status, approval_sent_at, approval_approved_at")
    .eq("id", taskId)
    .single();

  const now = new Date().toISOString();
  const updates: {
    status: "done";
    pushed_to_main: boolean;
    completion_note: string | null;
    branch_name: string | null;
    completed_at: string;
    updated_at: string;
    approval_approved_at?: string;
  } = {
    status: "done",
    pushed_to_main: parsed.data.pushed_to_main,
    completion_note: parsed.data.completion_note ?? null,
    branch_name: branchName,
    completed_at: now,
    updated_at: now,
  };

  // Shipping a task resolves any open approval gate. A task can be sent for
  // approval and then marked Done before the operator signs off in-app (e.g.
  // the go-ahead happened on a call), which used to leave it stuck in the
  // operator's "Ready for your review" queue forever — isAwaitingApproval keys
  // off approval_sent_at && !approval_approved_at and never looked at status.
  // Stamp approval_approved_at so a done task never reads as awaiting approval.
  const resolvingApproval = !!before?.approval_sent_at && !before.approval_approved_at;
  if (resolvingApproval) {
    updates.approval_approved_at = now;
  }

  const { error } = await supabase.from("tasks").update(updates).eq("id", taskId);

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
  if (branchName) {
    await writeAuditEntry({
      taskId,
      actorId: profile.id,
      action: "task.branch_set",
      field: "branch_name",
      newValue: branchName,
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

const setBranchSchema = z.object({
  taskId: z.string().uuid(),
  branch_name: z.string().trim().max(200).nullish(),
  pushed_to_main: z.boolean().optional(),
});

/** Reassign (or clear) the feature branch a done task is grouped under on the
 *  staging view. Empty/whitespace clears it back to "no branch". When
 *  pushedToMain is passed (the branch picker sets it — true iff the chosen
 *  branch is the repo default), it's updated in the same write so the staged
 *  vs shipped split stays correct after an edit. */
export async function setTaskBranch(
  taskId: string,
  branchName: string | null,
  pushedToMain?: boolean
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = setBranchSchema.safeParse({
    taskId,
    branch_name: branchName,
    pushed_to_main: pushedToMain,
  });
  if (!parsed.success) return { error: "Invalid input" };
  if (!(await isTaskMember(taskId, profile.id)))
    return { error: "You don't have access to this task." };

  const next = parsed.data.branch_name?.trim() || null;

  const supabase = await getClient(profile.id);

  const { data: before } = await supabase
    .from("tasks")
    .select("branch_name")
    .eq("id", taskId)
    .single();

  const update: {
    branch_name: string | null;
    updated_at: string;
    pushed_to_main?: boolean;
  } = { branch_name: next, updated_at: new Date().toISOString() };
  if (parsed.data.pushed_to_main !== undefined) {
    update.pushed_to_main = parsed.data.pushed_to_main;
  }

  const { error } = await supabase.from("tasks").update(update).eq("id", taskId);

  if (error) return { error: error.message };

  if (before && (before.branch_name ?? null) !== next) {
    await writeAuditEntry({
      taskId,
      actorId: profile.id,
      action: "task.branch_changed",
      field: "branch_name",
      oldValue: before.branch_name ?? null,
      newValue: next,
    });
  }

  revalidatePath("/b");
  revalidatePath("/b/staging");
  return { success: true };
}

const setTasksPushedSchema = z.object({
  taskIds: z.array(z.string().uuid()).min(1).max(200),
  pushed: z.boolean(),
});

/** Bulk-flip pushed_to_main across many done tasks at once — powers the manual
 *  "Mark as pushed to main" button on the staging board (and its Undo, which
 *  calls back with pushed=false). Moves tasks between the Next-push and Shipped
 *  sections without touching branch_name. Only done tasks the builder may touch
 *  are affected: engagement tasks they're a member of, or their own personal
 *  (no-engagement) tasks. We filter by membership explicitly because a branch
 *  bucket can span engagements under the "All" filter (groupTasksByBranch keys
 *  on branch name only) and the dev admin client bypasses RLS. */
export async function setTasksPushedToMain(
  taskIds: string[],
  pushed: boolean
): Promise<{ success: true; movedIds: string[] } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = setTasksPushedSchema.safeParse({ taskIds, pushed });
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await getClient(profile.id);

  const { data: rows } = await supabase
    .from("tasks")
    .select("id, engagement_id, created_by, status, pushed_to_main")
    .in("id", parsed.data.taskIds);
  if (!rows || rows.length === 0) return { success: true, movedIds: [] };

  const myEngagementIds = new Set((await getMyEngagements()).map((e) => e.id));
  const allowedIds = rows
    .filter(
      (t) =>
        t.status === "done" &&
        t.pushed_to_main !== parsed.data.pushed &&
        (t.engagement_id
          ? myEngagementIds.has(t.engagement_id)
          : t.created_by === profile.id)
    )
    .map((t) => t.id);
  if (allowedIds.length === 0) return { success: true, movedIds: [] };

  const { error } = await supabase
    .from("tasks")
    .update({ pushed_to_main: parsed.data.pushed, updated_at: new Date().toISOString() })
    .in("id", allowedIds);
  if (error) return { error: error.message };

  // Audit isn't needed to render the move — defer it past the response like the
  // status-change path.
  after(() =>
    writeAuditEntries(
      allowedIds.map((id) => ({
        taskId: id,
        actorId: profile.id,
        action: "task.pushed_to_main_changed",
        field: "pushed_to_main",
        oldValue: !parsed.data.pushed,
        newValue: parsed.data.pushed,
      }))
    )
  );

  revalidatePath("/b");
  revalidatePath("/b/staging");
  return { success: true, movedIds: allowedIds };
}

const pollBranchMergesSchema = z.array(z.string().uuid()).max(50);

/** Auto-detect which staged feature branches have been merged into their repo's
 *  default branch and move their done tasks to Shipped. Runs on staging-board
 *  load and the "Check for pushes" button. Idempotent and undo-safe via the
 *  branch_push_marks table: a given merge sha ships once; undoing it leaves the
 *  recorded sha in place so the next poll won't re-ship. Returns the branches it
 *  just shipped so the client can toast (with Undo). */
export async function pollBranchMerges(
  engagementIds: string[]
): Promise<{ branch: string; taskIds: string[] }[]> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = pollBranchMergesSchema.safeParse(engagementIds);
  if (!parsed.success || parsed.data.length === 0) return [];

  const admin = createAdminClient();
  const shipped: { branch: string; taskIds: string[] }[] = [];

  for (const engagementId of parsed.data) {
    // getEngagementRepoById gates membership (null for non-members) and yields
    // the repo coords + a usable OAuth token.
    const repo = await getEngagementRepoById(engagementId, profile.id);
    if (!repo) continue;

    const { data: staged } = await admin
      .from("tasks")
      .select("branch_name")
      .eq("engagement_id", engagementId)
      .eq("status", "done")
      .eq("pushed_to_main", false)
      .not("branch_name", "is", null);

    const branches = Array.from(
      new Set(
        (staged ?? [])
          .map((r) => (r.branch_name as string | null)?.trim() || null)
          .filter(
            (b): b is string => b !== null && b !== repo.defaultBranch
          )
      )
    );

    for (const branch of branches) {
      const sha = await getMergedPrSha(repo, branch);
      if (!sha) continue;

      const { data: mark } = await admin
        .from("branch_push_marks")
        .select("merge_sha")
        .eq("repo_full_name", repo.fullName)
        .eq("branch_name", branch)
        .maybeSingle();
      if (!isNewMerge(mark?.merge_sha, sha)) continue; // already actioned or undone

      const { data: flipped } = await admin
        .from("tasks")
        .update({ pushed_to_main: true, updated_at: new Date().toISOString() })
        .eq("engagement_id", engagementId)
        .eq("status", "done")
        .eq("pushed_to_main", false)
        .eq("branch_name", branch)
        .select("id");

      await admin.from("branch_push_marks").upsert(
        {
          repo_full_name: repo.fullName,
          branch_name: branch,
          merge_sha: sha,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "repo_full_name,branch_name" }
      );

      const taskIds = (flipped ?? []).map((t) => t.id);
      if (taskIds.length > 0) {
        after(() =>
          writeAuditEntries(
            taskIds.map((id) => ({
              taskId: id,
              actorId: profile.id,
              action: "task.pushed_to_main_changed",
              field: "pushed_to_main",
              oldValue: false,
              newValue: true,
              metadata: { via: "pr_merge_poll", branch, merge_sha: sha },
            }))
          )
        );
        shipped.push({ branch, taskIds });
      }
    }
  }

  if (shipped.length > 0) {
    revalidatePath("/b");
    revalidatePath("/b/staging");
  }
  return shipped;
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
  if (!(await isTaskMember(taskId, profile.id)))
    return { error: "You don't have access to this task." };

  // Approval is not a status move — the task stays in its column and the
  // approval_sent_at stamp drives the pill + pin in the UI.
  const now = new Date().toISOString();
  const updates: Record<string, string | null> = {
    approval_sent_at: now,
    updated_at: now,
  };
  if (parsed.data.note) {
    updates.completion_note = parsed.data.note;
  }

  const supabase = await getClient(profile.id);

  const { error } = await supabase.from("tasks").update(updates).eq("id", taskId);

  if (error) return { error: error.message };

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

const withdrawApprovalSchema = z.object({
  taskId: z.string().uuid(),
});

// Builder-side reverse of markTaskForApproval: pulls a task back out of the
// approval queue by clearing approval_sent_at. Approval is a timestamp gate,
// not a status, so the task keeps its column (stays In Progress) — we only drop
// the stamp that pins it and feeds the operator's review queue. The builder's
// completion_note is left intact so an unsend → edit → resend keeps their note.
export async function withdrawTaskApproval(
  taskId: string
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  if (!withdrawApprovalSchema.safeParse({ taskId }).success)
    return { error: "Invalid input" };
  if (!(await isTaskMember(taskId, profile.id)))
    return { error: "You don't have access to this task." };

  const supabase = await getClient(profile.id);

  const { data: before } = await supabase
    .from("tasks")
    .select("approval_sent_at, approval_approved_at")
    .eq("id", taskId)
    .single();

  if (!before) return { error: "Task not found." };
  if (!before.approval_sent_at) return { error: "Task hasn't been sent for approval." };
  if (before.approval_approved_at)
    return { error: "This task was already approved and can't be unsent." };

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("tasks")
    .update({ approval_sent_at: null, updated_at: now })
    .eq("id", taskId);

  if (error) return { error: error.message };

  await writeAuditEntry({
    taskId,
    actorId: profile.id,
    action: "task.approval_withdrawn",
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
  if (!(await isTaskMember(taskId, profile.id)))
    return { error: "You don't have access to this task." };

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

const requestChangesSchema = z.object({
  taskId: z.string().uuid(),
  note: z.string().trim().max(2000).nullish(),
});

// Operator send-back on a task awaiting approval: clears the approval stamp and
// returns the task to In Progress so the builder picks it back up. The
// operator's note lives in the audit entry — completion_note stays the
// builder's submission note (overwritten on their next re-submit).
export async function requestTaskChanges(
  taskId: string,
  payload: { note: string | null }
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "operator") return { error: "Only operators can request changes." };

  const parsed = requestChangesSchema.safeParse({ taskId, ...payload });
  if (!parsed.success) return { error: "Invalid input" };
  if (!(await isTaskMember(taskId, profile.id)))
    return { error: "You don't have access to this task." };

  const supabase = await getClient(profile.id);

  const { data: before } = await supabase
    .from("tasks")
    .select("status, approval_sent_at, approval_approved_at")
    .eq("id", taskId)
    .single();

  if (!before) return { error: "Task not found." };
  if (!before.approval_sent_at) return { error: "Task is not awaiting approval." };
  if (before.approval_approved_at) return { error: "Task was already approved." };

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("tasks")
    .update({ approval_sent_at: null, status: "in_progress", updated_at: now })
    .eq("id", taskId);

  if (error) return { error: error.message };

  await writeAuditEntry({
    taskId,
    actorId: profile.id,
    action: "task.changes_requested",
    metadata: parsed.data.note ? { note: parsed.data.note } : null,
  });
  if (before.status !== "in_progress") {
    await writeAuditEntry({
      taskId,
      actorId: profile.id,
      action: "task.status_changed",
      field: "status",
      oldValue: before.status,
      newValue: "in_progress",
    });
  }

  revalidatePath("/b");
  revalidatePath("/o");
  return { success: true };
}

const taskStatusSchema = z.enum(["backlog", "todo", "in_progress", "done"]);

export async function updateTaskStatus(taskId: string, status: TaskStatus) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!taskStatusSchema.safeParse(status).success)
    return { error: "Invalid status" };

  const supabase = await getClient(profile.id);

  // Membership gate and the current status are independent single-row reads, so
  // fetch them together rather than serially — this is the hot path for every
  // to-do → in-progress style move and each round-trip is felt.
  const [member, { data: before }] = await Promise.all([
    isTaskMember(taskId, profile.id),
    supabase.from("tasks").select("status").eq("id", taskId).single(),
  ]);
  if (!member) return { error: "You don't have access to this task." };

  const { error } = await supabase
    .from("tasks")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", taskId);

  if (error) return { error: error.message };

  // The audit entry isn't needed to render the move — defer it past the response
  // (like the create-task estimate) so the status change returns as soon as the
  // row is written instead of blocking on another DB round-trip.
  if (before && before.status !== status) {
    after(() =>
      writeAuditEntry({
        taskId,
        actorId: profile.id,
        action: "task.status_changed",
        field: "status",
        oldValue: before.status,
        newValue: status,
      })
    );
  }

  revalidatePath("/b");
  revalidatePath("/o");
  return { success: true };
}

export async function reorderTask(taskId: string, sortOrder: number) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!(await isTaskMember(taskId, profile.id)))
    return { error: "You don't have access to this task." };

  const supabase = await getClient(profile.id);
  const { error } = await supabase
    .from("tasks")
    .update({ sort_order: sortOrder, updated_at: new Date().toISOString() })
    .eq("id", taskId);

  if (error) return { error: error.message };
  revalidatePath("/b");
  return { success: true };
}

// ── Apply an AI task regeneration ────────────────────────────────────────────
// Persists the rewrite the builder approved in the sidebar (see
// regenerateTask in lib/actions/ai-tasks.ts): the revised task fields plus the
// reconciled subtask plan, atomically-ish, with an audit trail and a deferred
// re-estimate. The subtask `final`/`remove` shape mirrors reconcileSubtaskPlan;
// display-only keys (from/completed/reason) are ignored by the schema.
const applyRegenSchema = z.object({
  taskId: z.string().uuid(),
  changeNote: z.string().trim().max(1000).optional(),
  task: z.object({
    title: z.string().min(1).max(300),
    description: z.string().max(2000),
    priority: z.enum(["low", "medium", "high", "urgent"]),
    type: z.enum(["feature", "bug", "change"]),
    tags: z.array(z.enum(TASK_TAGS)).max(1),
  }),
  final: z
    .array(
      z.discriminatedUnion("op", [
        z.object({ op: z.literal("keep"), id: z.string().uuid(), title: z.string().min(1).max(300) }),
        z.object({ op: z.literal("rename"), id: z.string().uuid(), title: z.string().min(1).max(300) }),
        z.object({ op: z.literal("add"), title: z.string().min(1).max(300) }),
        z.object({ op: z.literal("preserved"), id: z.string().uuid(), title: z.string().min(1).max(300) }),
      ])
    )
    .max(40),
  remove: z.array(z.object({ id: z.string().uuid() })).max(40),
});

export interface ApplyTaskRegenerationInput {
  taskId: string;
  changeNote?: string;
  task: {
    title: string;
    description: string;
    priority: "low" | "medium" | "high" | "urgent";
    type: "feature" | "bug" | "change";
    tags: TaskTag[];
  };
  final: { op: "keep" | "rename" | "add" | "preserved"; id?: string; title: string }[];
  remove: { id: string }[];
}

export async function applyTaskRegeneration(
  input: ApplyTaskRegenerationInput
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only builders can regenerate tasks." };

  const parsed = applyRegenSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const { taskId, task: fields, final, remove, changeNote } = parsed.data;

  if (!(await isTaskMember(taskId, profile.id)))
    return { error: "You don't have access to this task." };

  const supabase = await getClient(profile.id);

  // The task's real subtasks are the source of truth for which ids we may touch,
  // guarding against a stale or tampered proposal referencing foreign rows.
  const { data: currentRows } = await supabase
    .from("task_subtasks")
    .select("id, title")
    .eq("task_id", taskId);
  const currentById = new Map<string, string>(
    (currentRows ?? []).map((r) => [r.id as string, r.title as string])
  );

  const { data: before } = await supabase
    .from("tasks")
    .select("title, description, priority, type, tags")
    .eq("id", taskId)
    .single();

  // ── Task fields ──
  const { error: taskErr } = await supabase
    .from("tasks")
    .update({
      title: fields.title,
      description: fields.description,
      priority: fields.priority,
      type: fields.type,
      tags: fields.tags,
      updated_at: new Date().toISOString(),
    })
    .eq("id", taskId);
  if (taskErr) return { error: taskErr.message };

  const audits: AuditEntryInput[] = [];

  // ── Subtasks: deletes → updates (rename + reorder) → inserts ──
  // Position is the index in `final`, so the approved order is what lands.
  const removeIds = remove.map((r) => r.id).filter((id) => currentById.has(id));
  if (removeIds.length > 0) {
    const { error } = await supabase
      .from("task_subtasks")
      .delete()
      .in("id", removeIds)
      .eq("task_id", taskId);
    if (!error) {
      for (const id of removeIds) {
        audits.push({
          taskId,
          actorId: profile.id,
          action: "subtask.deleted",
          metadata: { title: currentById.get(id) ?? null },
        });
      }
    }
  }

  const inserts: { task_id: string; created_by: string; title: string; position: number }[] = [];
  const updates: PromiseLike<unknown>[] = [];
  final.forEach((item, position) => {
    if (item.op === "add") {
      inserts.push({ task_id: taskId, created_by: profile.id, title: item.title, position });
      return;
    }
    // keep / rename / preserved reference an existing row; skip anything the
    // task no longer owns (deleted between preview and apply, or foreign).
    if (!item.id || !currentById.has(item.id)) return;
    const oldTitle = currentById.get(item.id)!;
    const patch: Record<string, unknown> = { position, updated_at: new Date().toISOString() };
    if (item.op === "rename" && item.title !== oldTitle) {
      patch.title = item.title;
      audits.push({
        taskId,
        subtaskId: item.id,
        actorId: profile.id,
        action: "subtask.renamed",
        field: "title",
        oldValue: oldTitle,
        newValue: item.title,
      });
    }
    updates.push(supabase.from("task_subtasks").update(patch).eq("id", item.id).eq("task_id", taskId));
  });

  if (updates.length > 0) await Promise.all(updates);

  if (inserts.length > 0) {
    const { data: created } = await supabase
      .from("task_subtasks")
      .insert(inserts)
      .select("id, title");
    for (const row of created ?? []) {
      audits.push({
        taskId,
        subtaskId: row.id as string,
        actorId: profile.id,
        action: "subtask.created",
        metadata: { title: row.title as string },
      });
    }
  }

  // ── Audit: the regenerate itself + each changed task field ──
  audits.push({
    taskId,
    actorId: profile.id,
    action: "task.regenerated",
    metadata: { changeNote: changeNote ?? null },
  });
  if (before) {
    const fieldEntries: [string, unknown][] = [
      ["title", fields.title],
      ["description", fields.description],
      ["priority", fields.priority],
      ["type", fields.type],
      ["tags", fields.tags],
    ];
    for (const [field, newValue] of fieldEntries) {
      const old = (before as Record<string, unknown>)[field];
      const changed =
        field === "tags"
          ? JSON.stringify(old ?? []) !== JSON.stringify(newValue)
          : old !== newValue;
      if (changed) {
        audits.push({
          taskId,
          actorId: profile.id,
          action: "task.field_changed",
          field,
          oldValue: old,
          newValue,
        });
      }
    }
  }
  await writeAuditEntries(audits);

  // Re-derive the hour estimate from the revised scope (deferred, same as
  // create/edit) — regenerating often grows or shrinks the work.
  after(() =>
    estimateAndSaveTaskHours({
      taskId,
      title: fields.title,
      description: fields.description,
      priority: fields.priority,
      userId: profile.id,
    })
  );

  revalidatePath("/b");
  revalidatePath("/o");
  return { success: true };
}

export async function deleteTask(taskId: string) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!(await isTaskMember(taskId, profile.id)))
    return { error: "You don't have access to this task." };

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
