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
import { notifyTaskEvent } from "@/lib/email/task-notify";
import { getMyEngagements } from "@/lib/actions/invitations";
import { getEngagementRepoById } from "@/lib/github/engagement-repo";
import { getDefaultBranchTip } from "@/lib/github/recent-commits";
import { parseMergedBranch, mergeSubject } from "@/lib/github/merge-subject";
import { isUniqueViolation } from "@/lib/supabase/errors";
import { findSimilarTitles } from "@/lib/tasks/dedupe";
import {
  TASK_TAGS,
  WORK_KINDS,
  type TaskStatus,
  type TaskTag,
  type WorkKind,
} from "@/lib/types";

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

type DbClient = Awaited<ReturnType<typeof getClient>>;

/** The push a task shipped in, when we can name it: a repo + the sha that put
 *  the work on the default branch, plus that commit's message when the caller
 *  has it (the release stores its subject line as the push's label). */
type ShipRef = {
  repo_full_name: string;
  merge_sha: string;
  message?: string | null;
};

/**
 * The release a just-shipped task attaches to (migration 0084).
 *
 * With a merge sha this is the *auto* release for that push, found-or-created —
 * so two tasks confirmed against the same commit land in one release rather
 * than each spawning its own. Without one it's a fresh *manual* release: the
 * builder asserting that this specific thing is live.
 *
 * Awaited inline, never deferred into after(): a task that claims it shipped
 * has to point at a real release, so a failure here must stop the flip.
 */
async function resolveShipRelease(
  supabase: DbClient,
  opts: {
    profileId: string;
    engagementId: string | null;
    branchName: string | null;
    title: string | null;
    shippedAt: string;
    ship?: ShipRef | null;
  }
): Promise<{ id: string } | { error: string }> {
  // An auto release must be engagement-scoped (releases_auto_has_engagement),
  // so a personal task falls back to a manual one even with a sha in hand.
  const ship = opts.engagementId !== null ? opts.ship : null;

  if (ship) {
    const findExisting = async () => {
      const { data } = await supabase
        .from("releases")
        .select("id")
        .eq("engagement_id", opts.engagementId)
        .eq("repo_full_name", ship.repo_full_name)
        .eq("merge_sha", ship.merge_sha)
        .maybeSingle();
      return (data?.id as string | undefined) ?? null;
    };

    const existing = await findExisting();
    if (existing) return { id: existing };

    const { data, error } = await supabase
      .from("releases")
      .insert({
        engagement_id: opts.engagementId,
        created_by: opts.profileId,
        kind: "auto",
        title: opts.title,
        repo_full_name: ship.repo_full_name,
        branch_name: opts.branchName,
        merge_sha: ship.merge_sha,
        merge_subject: ship.message ? mergeSubject(ship.message) : null,
        shipped_at: opts.shippedAt,
      })
      .select("id")
      .single();
    if (!error && data) return { id: data.id as string };

    // Lost the race with a concurrent poll — releases_merge_sha_key is the
    // backstop, so re-read the winner rather than failing the ship.
    if (isUniqueViolation(error)) {
      const raced = await findExisting();
      if (raced) return { id: raced };
    }
    return { error: error?.message ?? "Couldn't record the release." };
  }

  const { data, error } = await supabase
    .from("releases")
    .insert({
      engagement_id: opts.engagementId,
      created_by: opts.profileId,
      kind: "manual",
      title: opts.title,
      branch_name: opts.branchName,
      shipped_at: opts.shippedAt,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Couldn't record the release." };
  return { id: data.id as string };
}

/**
 * The staging group name shared by *every* one of these tasks, or null when
 * they're split across groups or any is ungrouped. Seeds a release title, so a
 * batch the builder planned as "Release 1.2" ships under that name instead of a
 * bare branch label.
 */
async function unanimousGroupName(
  supabase: DbClient,
  groupIds: (string | null)[]
): Promise<string | null> {
  if (groupIds.length === 0 || groupIds.some((g) => !g)) return null;
  const unique = Array.from(new Set(groupIds as string[]));
  if (unique.length !== 1) return null;

  const { data } = await supabase
    .from("staging_groups")
    .select("name")
    .eq("id", unique[0])
    .maybeSingle();
  return (data?.name as string | undefined) ?? null;
}

/**
 * Drop releases that an Undo just emptied. Deliberately narrow: only manual
 * releases the app created, and only when nothing points at them any more.
 *
 * An emptied *auto* release must survive — it is the idempotency tombstone that
 * stops the next pollMainMerges from re-shipping the very work the builder
 * just undid.
 */
async function gcEmptyManualReleases(
  supabase: DbClient,
  releaseIds: string[]
): Promise<void> {
  for (const id of releaseIds) {
    const { data: release } = await supabase
      .from("releases")
      .select("id, kind, source")
      .eq("id", id)
      .maybeSingle();
    if (!release || release.kind !== "manual" || release.source !== "app") continue;

    const { count: taskCount } = await supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("release_id", id);
    if ((taskCount ?? 0) > 0) continue;

    const { count: childCount } = await supabase
      .from("releases")
      .select("id", { count: "exact", head: true })
      .eq("combined_into_id", id);
    if ((childCount ?? 0) > 0) continue;

    await supabase.from("releases").delete().eq("id", id);
  }
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
    // The push this went live in, when the caller knows it — set by
    // confirmMatchedTaskDone, which has the default-branch commit in hand. Two
    // tasks confirmed against the same commit then share one release.
    ship?: ShipRef | null;
    // Whether to email the operator that the work was delivered. Defaults on;
    // the auto-apply path (commit-task-matches) turns it off because a task the
    // scan marked done on its own is still awaiting the builder's word, and an
    // email can't be unsent when they reject it. Their Keep releases it.
    notify?: boolean;
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
    .select(
      "status, approval_sent_at, approval_approved_at, engagement_id, pushed_to_main, release_id, staging_group_id"
    )
    .eq("id", taskId)
    .single();

  const now = new Date().toISOString();

  // Attach the task to the push it went live in. Re-marking an already-shipped
  // task keeps its existing release rather than spawning a duplicate; un-marking
  // detaches it so it falls back into "Next push".
  let releaseId: string | null = null;
  if (parsed.data.pushed_to_main) {
    if (before?.pushed_to_main && before.release_id) {
      releaseId = before.release_id as string;
    } else {
      const title = await unanimousGroupName(supabase, [
        (before?.staging_group_id as string | null) ?? null,
      ]);
      const release = await resolveShipRelease(supabase, {
        profileId: profile.id,
        engagementId: (before?.engagement_id as string | null) ?? null,
        branchName,
        title,
        shippedAt: now,
        ship: payload.ship ?? null,
      });
      if ("error" in release) return { error: release.error };
      releaseId = release.id;
    }
  }

  const updates: {
    status: "done";
    pushed_to_main: boolean;
    completion_note: string | null;
    branch_name: string | null;
    completed_at: string;
    updated_at: string;
    release_id: string | null;
    shipped_at: string | null;
    approval_approved_at?: string;
  } = {
    status: "done",
    pushed_to_main: parsed.data.pushed_to_main,
    completion_note: parsed.data.completion_note ?? null,
    branch_name: branchName,
    completed_at: now,
    updated_at: now,
    release_id: releaseId,
    shipped_at: parsed.data.pushed_to_main ? now : null,
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

  revalidatePath("/b");
  revalidatePath("/o");

  // The audit trail (1–3 rows) is non-blocking — defer it past the response so
  // the status flip returns immediately and the client can settle the
  // optimistic "done" paint without waiting on the log writes.
  after(async () => {
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

    // Email the operator that the task was delivered — only on an actual
    // transition into done, so re-marking an already-done task doesn't re-notify.
    // The audit rows above still write when notify is off: the trail should
    // record the auto-move, it's only the outward-facing mail that waits.
    if (before && before.status !== "done" && payload.notify !== false) {
      await notifyTaskEvent({
        taskId,
        actor: profile,
        event: "delivered",
        note: parsed.data.completion_note ?? null,
      });
    }
  });

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
    .select("id, engagement_id, created_by, status, pushed_to_main, release_id, staging_group_id")
    .in("id", parsed.data.taskIds);
  if (!rows || rows.length === 0) return { success: true, movedIds: [] };

  const myEngagementIds = new Set((await getMyEngagements()).map((e) => e.id));
  const allowed = rows.filter(
    (t) =>
      t.status === "done" &&
      t.pushed_to_main !== parsed.data.pushed &&
      (t.engagement_id
        ? myEngagementIds.has(t.engagement_id)
        : t.created_by === profile.id)
  );
  const allowedIds = allowed.map((t) => t.id);
  if (allowedIds.length === 0) return { success: true, movedIds: [] };

  const now = new Date().toISOString();

  if (!parsed.data.pushed) {
    // Undo: detach from the release as well, or the task would keep claiming a
    // ship date while sitting back in "Next push".
    const { error } = await supabase
      .from("tasks")
      .update({
        pushed_to_main: false,
        release_id: null,
        shipped_at: null,
        updated_at: now,
      })
      .in("id", allowedIds);
    if (error) return { error: error.message };

    // Sweep up releases this emptied — manual ones only; an emptied auto
    // release is the tombstone that stops the poll re-shipping this work.
    const detached = Array.from(
      new Set(allowed.map((t) => t.release_id as string | null).filter((r): r is string => !!r))
    );
    if (detached.length > 0) after(() => gcEmptyManualReleases(supabase, detached));
  } else {
    // A branch bucket can span engagements under the "All" filter, but a release
    // never does — so ship one manual release per engagement (personal tasks
    // forming their own partition).
    const partitions = new Map<string, typeof allowed>();
    for (const t of allowed) {
      const key = (t.engagement_id as string | null) ?? "personal";
      const bucket = partitions.get(key);
      if (bucket) bucket.push(t);
      else partitions.set(key, [t]);
    }

    for (const [, group] of partitions) {
      const title = await unanimousGroupName(
        supabase,
        group.map((t) => (t.staging_group_id as string | null) ?? null)
      );
      const release = await resolveShipRelease(supabase, {
        profileId: profile.id,
        engagementId: (group[0].engagement_id as string | null) ?? null,
        branchName: null,
        title,
        shippedAt: now,
      });
      if ("error" in release) return { error: release.error };

      const { error } = await supabase
        .from("tasks")
        .update({
          pushed_to_main: true,
          release_id: release.id,
          shipped_at: now,
          updated_at: now,
        })
        .in(
          "id",
          group.map((t) => t.id)
        );
      if (error) return { error: error.message };
    }
  }

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

const pollMainMergesSchema = z.array(z.string().uuid()).max(50);

type ShippedPush = { branch: string | null; taskIds: string[]; releaseId: string };

/** Detect that a new push reached each engagement's default branch and move
 *  every task waiting in Next push into that one release.
 *
 *  A release is one push to main, not one branch. Work reaches main through
 *  whatever integration branch the builder uses (feature → dev → main), so
 *  keying membership on `branch_name` stranded every task tagged with a branch
 *  that merges somewhere other than main. The branch is a label now; the tip
 *  sha is the identity. Idempotent and undo-safe: a sha already on the ledger
 *  ships once, and an emptied release stays behind as its tombstone.
 *
 *  Takes a resolved profile id rather than reading auth, so the background sweep
 *  can share it — `redirect()` is not callable from `after()`. */
async function shipPushedTasks(
  profileId: string,
  engagementIds: string[],
  opts: { fresh?: boolean } = {}
): Promise<ShippedPush[]> {
  const admin = createAdminClient();
  const shipped: ShippedPush[] = [];

  for (const engagementId of engagementIds) {
    // getEngagementRepoById gates membership (null for non-members) and yields
    // the repo coords + a usable OAuth token.
    const repo = await getEngagementRepoById(engagementId, profileId);
    if (!repo) continue;

    // Every push gets a row, whether or not anything was waiting for it. This
    // used to short-circuit on "nothing queued" to skip the GitHub round-trip,
    // but that is exactly the push where the builder tracked nothing at all —
    // and with no release row there is nowhere to hang the untracked-work scan
    // (0086). The read is cached for 300s and already shared with the commit
    // scan, so an unchanged repo costs one indexed lookup.
    const tip = await getDefaultBranchTip(repo, { fresh: opts.fresh });
    if (!tip) continue;

    // Claim the push on the releases ledger. This is set membership over every
    // sha we've ever shipped: an emptied release stays behind as a tombstone, so
    // an undone auto-move is never re-shipped and a force-push back to an older
    // tip is a permanent no-op rather than a second release.
    const { data: seen } = await admin
      .from("releases")
      .select("id")
      .eq("engagement_id", engagementId)
      .eq("repo_full_name", repo.fullName)
      .eq("merge_sha", tip.sha)
      .maybeSingle();
    if (seen) continue;

    const now = new Date().toISOString();
    // Date the release by the PUSH, not by whenever someone happened to open the
    // board. Detection is lazy — it runs on a page visit — so using `now` would
    // stamp a push from last Friday with today's date and quietly corrupt the
    // timeline every time nobody looked for a while.
    const shippedAt = tip.committedAt ?? now;

    const { data: release, error: releaseError } = await admin
      .from("releases")
      .insert({
        engagement_id: engagementId,
        created_by: profileId,
        kind: "auto",
        repo_full_name: repo.fullName,
        // Only a merge commit names a branch; a plain push to main leaves this
        // null. The subject line always says something, which is why the
        // timeline labels by it first and only then falls back to branch/date.
        branch_name: parseMergedBranch(tip.message),
        merge_subject: mergeSubject(tip.message),
        merge_sha: tip.sha,
        shipped_at: shippedAt,
      })
      .select("id")
      .single();
    // A concurrent poll won the claim and is shipping this batch itself.
    if (releaseError || !release) continue;

    let flip = admin
      .from("tasks")
      .update({
        pushed_to_main: true,
        release_id: release.id,
        shipped_at: shippedAt,
        updated_at: now,
      })
      .eq("engagement_id", engagementId)
      .eq("status", "done")
      .eq("pushed_to_main", false);
    // A push cannot have carried work that was finished after it. Without this,
    // a task completed this morning joins last Friday's release and the timeline
    // claims it shipped before it was done. An unknown completion date can't
    // disprove anything, so it stays in — same rule the commit matcher uses.
    if (tip.committedAt) {
      flip = flip.or(`completed_at.is.null,completed_at.lte.${tip.committedAt}`);
    }
    const { data: flipped } = await flip.select("id, staging_group_id");

    // Name the push after the batch the builder planned, when they all agree.
    const title = await unanimousGroupName(
      admin,
      (flipped ?? []).map((t) => (t.staging_group_id as string | null) ?? null)
    );
    if (title) {
      await admin
        .from("releases")
        .update({ title, updated_at: now })
        .eq("id", release.id);
    }

    const taskIds = (flipped ?? []).map((t) => t.id);
    if (taskIds.length > 0) {
      after(() =>
        writeAuditEntries(
          taskIds.map((id) => ({
            taskId: id,
            actorId: profileId,
            action: "task.pushed_to_main_changed",
            field: "pushed_to_main",
            oldValue: false,
            newValue: true,
            metadata: {
              via: "main_push_poll",
              branch: parseMergedBranch(tip.message),
              merge_sha: tip.sha,
            },
          }))
        )
      );
    }
    // Reported even when it moved nothing. The release row is the find — the
    // Shipped timeline renders it whether or not a task rode along — so
    // withholding it left a detected push invisible until a full reload, and
    // left the button with nothing to say about a push it had just recorded.
    shipped.push({
      branch: parseMergedBranch(tip.message),
      taskIds,
      releaseId: release.id as string,
    });
  }

  return shipped;
}

/** Staging-board load and the "Check for pushes" button. Returns every push it
 *  recorded so the client can toast (with Undo).
 *
 *  `fresh` is the button: an explicit check bypasses the 300s GitHub cache the
 *  mount read and the background sweep share, so pressing it right after a push
 *  sees the push instead of a five-minute-old tip. */
export async function pollMainMerges(
  engagementIds: string[],
  opts?: { fresh?: boolean }
): Promise<ShippedPush[]> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = pollMainMergesSchema.safeParse(engagementIds);
  if (!parsed.success || parsed.data.length === 0) return [];

  const shipped = await shipPushedTasks(profile.id, parsed.data, {
    fresh: opts?.fresh === true,
  });
  if (shipped.length > 0) {
    revalidatePath("/b");
    revalidatePath("/b/staging");
  }
  return shipped;
}

/**
 * The same detection, run in the background from the builder layout — safe to
 * call from `after()`.
 *
 * Detection used to happen only when someone opened `/b/staging`, so a push
 * went unrecorded for as long as that page went unvisited. Now any builder page
 * catches it. Idempotent against the ledger, so the extra calls are free: the
 * GitHub read is cached and shared with the commit scan, and a sha already
 * recorded costs one indexed lookup. Silent by design — the toast belongs to the
 * staging board, and this must never take a page down, so everything is
 * swallowed.
 */
export async function sweepMainPushes(): Promise<void> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "builder") return;

  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("engagements")
      .select("id")
      .eq("builder_id", profile.id)
      .not("started_at", "is", null);

    const ids = (data ?? []).map((e) => e.id as string);
    if (ids.length === 0) return;

    const shipped = await shipPushedTasks(profile.id, ids);
    if (shipped.length > 0) {
      revalidatePath("/b");
      revalidatePath("/b/staging");
    }
  } catch {
    // A background catch-up that throws would surface as a failed page render.
  }
}

const markForApprovalSchema = z.object({
  taskId: z.string().uuid(),
  note: z.string().trim().max(2000).nullish(),
  // What kind of work this was (migration 0089). Only "code" carries a branch;
  // the other kinds are the ones that used to be squeezed through a
  // deliverable-shaped dialog they had no deliverable for.
  workKind: z.enum(WORK_KINDS).optional(),
  // Omitted (undefined) leaves whatever the task already had — only the code
  // chip, with a real repo behind it, sends a value. Explicit null is "no
  // branch" and does clear it.
  branchName: z.string().trim().max(255).nullish(),
});

export async function markTaskForApproval(
  taskId: string,
  payload: {
    note: string | null;
    workKind?: WorkKind;
    branchName?: string | null;
  }
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
  if (parsed.data.workKind) {
    updates.work_kind = parsed.data.workKind;
    // A task that isn't code can't be on a branch. Clearing here matters on a
    // re-submit: a task first sent as code and corrected to "email" would
    // otherwise keep the branch it was filed under.
    if (parsed.data.workKind !== "code") updates.branch_name = null;
  }
  if (parsed.data.branchName !== undefined && parsed.data.workKind === "code") {
    updates.branch_name = parsed.data.branchName || null;
  }

  const supabase = await getClient(profile.id);

  const { error } = await supabase.from("tasks").update(updates).eq("id", taskId);

  if (error) return { error: error.message };

  await writeAuditEntry({
    taskId,
    actorId: profile.id,
    action: "task.sent_for_approval",
    metadata:
      parsed.data.note || parsed.data.workKind
        ? {
            ...(parsed.data.note ? { note: parsed.data.note } : {}),
            ...(parsed.data.workKind ? { work_kind: parsed.data.workKind } : {}),
          }
        : null,
  });

  // Email the operator that a task is ready for their review — deferred so the
  // send never blocks the response.
  after(() =>
    notifyTaskEvent({ taskId, actor: profile, event: "approval_requested", note: parsed.data.note ?? null })
  );

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

  // Email the builder that their task was approved.
  after(() => notifyTaskEvent({ taskId, actor: profile, event: "approved" }));

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

  // Email the builder that changes were requested — include the operator's note.
  after(() =>
    notifyTaskEvent({ taskId, actor: profile, event: "changes_requested", note: parsed.data.note ?? null })
  );

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

// Pin (or unpin) a task to the top of the board. Available to both roles — the
// operator pins from /o, the pin also lifts the task on the builder's /b. Member
// gate mirrors reorderTask; operators pass it for their own engagement's tasks.
export async function setTaskPinned(taskId: string, pinned: boolean) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!(await isTaskMember(taskId, profile.id)))
    return { error: "You don't have access to this task." };

  const now = new Date().toISOString();
  const supabase = await getClient(profile.id);
  const { error } = await supabase
    .from("tasks")
    .update({ pinned_at: pinned ? now : null, updated_at: now })
    .eq("id", taskId);

  if (error) return { error: error.message };

  // Deferred like updateTaskStatus — the pin repaints from the returned row, the
  // audit trail doesn't need to block the response.
  after(() =>
    writeAuditEntry({
      taskId,
      actorId: profile.id,
      action: pinned ? "task.pinned" : "task.unpinned",
      field: "pinned_at",
    })
  );

  revalidatePath("/o");
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

const deleteTasksSchema = z.array(z.string().uuid()).min(1).max(200);

/** Bulk-delete many tasks at once — powers multi-select delete on the build
 *  board. Mirrors deleteTask's storage cleanup (the FK cascade drops
 *  task_attachments rows but never the underlying storage objects) but does it
 *  in a single set-based pass. Only tasks the builder may touch are removed:
 *  engagement tasks they're a member of, or their own personal (no-engagement)
 *  tasks — we filter membership explicitly because the admin client bypasses
 *  RLS and the board's "All" filter can span engagements. */
export async function deleteTasks(
  taskIds: string[]
): Promise<{ success: true; deletedIds: string[] } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const parsed = deleteTasksSchema.safeParse(taskIds);
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await getClient(profile.id);

  const { data: rows } = await supabase
    .from("tasks")
    .select("id, engagement_id, created_by")
    .in("id", parsed.data);
  if (!rows || rows.length === 0) return { success: true, deletedIds: [] };

  const myEngagementIds = new Set((await getMyEngagements()).map((e) => e.id));
  const allowedIds = rows
    .filter((t) =>
      t.engagement_id ? myEngagementIds.has(t.engagement_id) : t.created_by === profile.id
    )
    .map((t) => t.id);
  if (allowedIds.length === 0) return { error: "You don't have access to these tasks." };

  // Gather attachment files before the row cascade so their storage objects
  // don't leak — same reason deleteTask does it per-task.
  const { data: files } = await supabase
    .from("task_attachments")
    .select("storage_path")
    .in("task_id", allowedIds)
    .not("storage_path", "is", null);

  const { error } = await supabase.from("tasks").delete().in("id", allowedIds);
  if (error) return { error: error.message };

  const paths = (files ?? []).map((f) => f.storage_path as string).filter(Boolean);
  if (paths.length) {
    await createAdminClient().storage.from("task-attachments").remove(paths);
  }

  revalidatePath("/o");
  revalidatePath("/b");
  return { success: true, deletedIds: allowedIds };
}
