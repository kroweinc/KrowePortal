import "server-only";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { embedAndStoreChunks } from "@/lib/context/embed-store";
import { fetchLinkText } from "@/lib/context/fetch-link";
import { extractTranscriptText } from "@/lib/sop/extract-text";
import { SOP_ALLOWED_EXTENSIONS } from "@/lib/attachments-constants";
import {
  serializeBrief,
  serializeChangeOrder,
  serializeAgreement,
  serializeTask,
  serializeTaskAttachment,
  serializeMilestone,
  serializeDeliverable,
  serializeInfra,
  serializeAvailability,
  serializeContextMaterial,
  serializeProjectMaterial,
  serializeProjectSop,
  serializeCodebase,
} from "@/lib/context/serialize-entities";
import type {
  Brief,
  ChangeOrder,
  EngagementAgreement,
  Deliverable,
  InfraRecommendation,
  ContextMaterial,
  Task,
  Subtask,
  Milestone,
  BuilderAvailability,
  ProjectMaterial,
  ProjectSopTranscript,
  TaskAttachment,
  ContextItemKind,
} from "@/lib/types";

// ============================================================
// Keep the Client Context Layer in lockstep with everything else that happens
// inside an engagement — briefs, change orders, the operating agreement,
// deliverables, infra recommendations, tasks, milestones, builder availability.
// Each row is serialized to text (serialize-entities.ts) and upserted as a
// context_item so it flows into RAG (semantic search + buildClientContext).
//
// This generalizes sync-document.ts / sync-profile.ts's upsert-diff-embed flow:
// one shared core (syncEntityContext) keyed by
//   source_meta = { source: "auto-entity", entity: "<name>", rowId? }
// (singletons like the agreement / availability omit rowId), plus a thin
// per-entity wrapper that loads the row(s) and serializes. Everything here is
// BEST-EFFORT — a failure must never break the triggering write, so callers
// fire-and-forget and we swallow errors after logging.
//
// created_by is ALWAYS the engagement's builder (context is builder-only via
// RLS), regardless of who triggered the write (operator edits sync too).
// ============================================================

type Admin = ReturnType<typeof createAdminClient>;

export interface EntityIdentity {
  /** Entity name, e.g. "change_order", "task", "agreement". */
  entity: string;
  /** Row PK for per-row entities; omitted for singletons (one per engagement). */
  rowId?: string;
  /**
   * Extra provenance merged into source_meta on insert (e.g. { taskId } so the
   * context graph can hang a mirror's node off its parent). Carried metadata
   * only — findExisting still matches on source/entity/rowId, never extraMeta.
   */
  extraMeta?: Record<string, unknown>;
}

/** Optional shared client / builder id so backfill avoids re-resolving per row. */
interface SyncCtx {
  admin?: Admin;
  builderId?: string;
}

function revalidate(engagementId: string): void {
  revalidatePath(`/b/engagements/${engagementId}`);
}

async function engagementBuilder(admin: Admin, engagementId: string): Promise<string | null> {
  const { data } = await admin
    .from("engagements")
    .select("builder_id")
    .eq("id", engagementId)
    .maybeSingle();
  return (data?.builder_id as string | null) ?? null;
}

async function findExisting(admin: Admin, engagementId: string, identity: EntityIdentity) {
  let q = admin
    .from("context_items")
    .select("id, title, content")
    .eq("engagement_id", engagementId)
    .eq("source_meta->>source", "auto-entity")
    .eq("source_meta->>entity", identity.entity);
  if (identity.rowId) q = q.eq("source_meta->>rowId", identity.rowId);
  return (await q.maybeSingle()).data;
}

/**
 * Create / refresh / delete the context_item mirroring one entity. Empty text
 * removes any existing mirror (the source no longer has anything to say); a
 * title-only change relabels without re-embedding; a content change replaces
 * chunks and re-embeds. No-ops when nothing changed. Mirrors the proven flow in
 * sync-document.ts / sync-profile.ts.
 */
export async function syncEntityContext(input: {
  admin: Admin;
  engagementId: string;
  builderId: string;
  kind: ContextItemKind;
  identity: EntityIdentity;
  title: string;
  text: string;
}): Promise<void> {
  const { admin, engagementId, builderId, kind, identity, title } = input;
  const text = input.text.trim();
  const existing = await findExisting(admin, engagementId, identity);

  // Nothing substantive to store — drop any stale mirror.
  if (!text) {
    if (existing) {
      await admin.from("context_items").delete().eq("id", existing.id as string);
      revalidate(engagementId);
    }
    return;
  }

  if (existing) {
    const titleChanged = existing.title !== title;
    const contentChanged = existing.content !== text;
    if (!titleChanged && !contentChanged) return;

    if (!contentChanged) {
      await admin
        .from("context_items")
        .update({ title, updated_at: new Date().toISOString() })
        .eq("id", existing.id as string);
      revalidate(engagementId);
      return;
    }

    await admin
      .from("context_items")
      .update({
        title,
        content: text,
        char_count: text.length,
        embedding_status: "pending",
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id as string);
    await admin.from("context_chunks").delete().eq("context_item_id", existing.id as string);
    await embedAndStoreChunks(existing.id as string, engagementId, text, builderId);
    revalidate(engagementId);
    return;
  }

  const { data: created, error } = await admin
    .from("context_items")
    .insert({
      engagement_id: engagementId,
      created_by: builderId,
      kind,
      title,
      content: text,
      char_count: text.length,
      source_meta: {
        source: "auto-entity",
        entity: identity.entity,
        ...(identity.rowId ? { rowId: identity.rowId } : {}),
        ...(identity.extraMeta ?? {}),
      },
    })
    .select("id")
    .single();
  if (error || !created) return;

  await embedAndStoreChunks(created.id as string, engagementId, text, builderId);
  revalidate(engagementId);
}

/**
 * Remove the context_item mirroring a deleted entity row (chunks cascade). For
 * delete triggers, which fire after the source row is gone, so we can't resolve
 * the engagement from the row — match by source_meta alone. Best-effort.
 */
export async function removeEntityContext(
  entity: string,
  rowId: string,
  engagementId?: string
): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin
      .from("context_items")
      .delete()
      .eq("source_meta->>source", "auto-entity")
      .eq("source_meta->>entity", entity)
      .eq("source_meta->>rowId", rowId);
    if (engagementId) revalidate(engagementId);
  } catch (err) {
    console.error("[removeEntityContext]", err);
  }
}

// ---- Per-entity wrappers ------------------------------------------------
// Each loads the row(s), serializes, and upserts. Safe to call after the row is
// gone — the serializer yields "" and syncEntityContext drops the mirror.

async function milestoneTitleFor(admin: Admin, milestoneId: string | null): Promise<string | null> {
  if (!milestoneId) return null;
  const { data } = await admin.from("milestones").select("title").eq("id", milestoneId).maybeSingle();
  return (data?.title as string | null) ?? null;
}

export async function syncBriefContext(briefId: string, ctx?: SyncCtx): Promise<void> {
  try {
    const admin = ctx?.admin ?? createAdminClient();
    const { data: row } = await admin.from("briefs").select("*").eq("id", briefId).maybeSingle();
    if (!row?.engagement_id) return; // project-scoped / orphan brief — no engagement to attach to
    const engagementId = row.engagement_id as string;
    const builderId = ctx?.builderId ?? (await engagementBuilder(admin, engagementId));
    if (!builderId) return;
    const b = row as Brief;
    await syncEntityContext({
      admin,
      engagementId,
      builderId,
      kind: "brief",
      identity: { entity: "brief", rowId: b.id },
      title: `Brief — ${b.title}`,
      text: serializeBrief(b),
    });
  } catch (err) {
    console.error("[syncBriefContext]", err);
  }
}

export async function syncChangeOrderContext(changeOrderId: string, ctx?: SyncCtx): Promise<void> {
  try {
    const admin = ctx?.admin ?? createAdminClient();
    const { data: row } = await admin
      .from("change_orders")
      .select("*")
      .eq("id", changeOrderId)
      .maybeSingle();
    if (!row?.engagement_id) return;
    const engagementId = row.engagement_id as string;
    const builderId = ctx?.builderId ?? (await engagementBuilder(admin, engagementId));
    if (!builderId) return;
    const co = row as ChangeOrder;
    await syncEntityContext({
      admin,
      engagementId,
      builderId,
      kind: "change_order",
      identity: { entity: "change_order", rowId: co.id },
      title: `Change order — ${co.title}`,
      text: serializeChangeOrder(co),
    });
  } catch (err) {
    console.error("[syncChangeOrderContext]", err);
  }
}

export async function syncAgreementContext(engagementId: string, ctx?: SyncCtx): Promise<void> {
  try {
    const admin = ctx?.admin ?? createAdminClient();
    const builderId = ctx?.builderId ?? (await engagementBuilder(admin, engagementId));
    if (!builderId) return;
    const { data: row } = await admin
      .from("engagement_agreement")
      .select("*")
      .eq("engagement_id", engagementId)
      .maybeSingle();
    await syncEntityContext({
      admin,
      engagementId,
      builderId,
      kind: "agreement",
      identity: { entity: "agreement" },
      title: "Operating agreement",
      text: row ? serializeAgreement(row as EngagementAgreement) : "",
    });
  } catch (err) {
    console.error("[syncAgreementContext]", err);
  }
}

export async function syncAvailabilityContext(engagementId: string, ctx?: SyncCtx): Promise<void> {
  try {
    const admin = ctx?.admin ?? createAdminClient();
    const builderId = ctx?.builderId ?? (await engagementBuilder(admin, engagementId));
    if (!builderId) return;
    const { data: row } = await admin
      .from("builder_availability")
      .select("*")
      .eq("engagement_id", engagementId)
      .maybeSingle();
    await syncEntityContext({
      admin,
      engagementId,
      builderId,
      kind: "availability",
      identity: { entity: "availability" },
      title: "Builder availability",
      text: row ? serializeAvailability(row as BuilderAvailability) : "",
    });
  } catch (err) {
    console.error("[syncAvailabilityContext]", err);
  }
}

export async function syncDeliverableContext(deliverableId: string, ctx?: SyncCtx): Promise<void> {
  try {
    const admin = ctx?.admin ?? createAdminClient();
    const { data: row } = await admin
      .from("deliverables")
      .select("*")
      .eq("id", deliverableId)
      .maybeSingle();
    if (!row?.engagement_id) return;
    const engagementId = row.engagement_id as string;
    const builderId = ctx?.builderId ?? (await engagementBuilder(admin, engagementId));
    if (!builderId) return;
    const d = row as Deliverable;
    const msTitle = await milestoneTitleFor(admin, d.milestone_id);
    await syncEntityContext({
      admin,
      engagementId,
      builderId,
      kind: "deliverable",
      identity: { entity: "deliverable", rowId: d.id },
      title: `Deliverable — ${d.title}`,
      text: serializeDeliverable(d, msTitle),
    });
  } catch (err) {
    console.error("[syncDeliverableContext]", err);
  }
}

export async function syncInfraContext(infraId: string, ctx?: SyncCtx): Promise<void> {
  try {
    const admin = ctx?.admin ?? createAdminClient();
    const { data: row } = await admin
      .from("infra_recommendations")
      .select("*")
      .eq("id", infraId)
      .maybeSingle();
    if (!row?.engagement_id) return;
    const engagementId = row.engagement_id as string;
    const builderId = ctx?.builderId ?? (await engagementBuilder(admin, engagementId));
    if (!builderId) return;
    const r = row as InfraRecommendation;
    await syncEntityContext({
      admin,
      engagementId,
      builderId,
      kind: "infra",
      identity: { entity: "infra", rowId: r.id },
      title: `Infrastructure — ${r.item}`,
      text: serializeInfra(r),
    });
  } catch (err) {
    console.error("[syncInfraContext]", err);
  }
}

export async function syncContextMaterialContext(materialId: string, ctx?: SyncCtx): Promise<void> {
  try {
    const admin = ctx?.admin ?? createAdminClient();
    const { data: row } = await admin
      .from("context_materials")
      .select("*")
      .eq("id", materialId)
      .maybeSingle();
    if (!row?.engagement_id) return;
    const engagementId = row.engagement_id as string;
    const builderId = ctx?.builderId ?? (await engagementBuilder(admin, engagementId));
    if (!builderId) return;
    const m = row as ContextMaterial;
    await syncEntityContext({
      admin,
      engagementId,
      builderId,
      kind: "material",
      identity: { entity: "context_material", rowId: m.id },
      title: `Material — ${m.title}`,
      text: serializeContextMaterial(m),
    });
  } catch (err) {
    console.error("[syncContextMaterialContext]", err);
  }
}

export async function syncMilestoneContext(milestoneId: string, ctx?: SyncCtx): Promise<void> {
  try {
    const admin = ctx?.admin ?? createAdminClient();
    const { data: row } = await admin
      .from("milestones")
      .select("*")
      .eq("id", milestoneId)
      .maybeSingle();
    if (!row?.engagement_id) return;
    const engagementId = row.engagement_id as string;
    const builderId = ctx?.builderId ?? (await engagementBuilder(admin, engagementId));
    if (!builderId) return;
    const m = row as Milestone;
    await syncEntityContext({
      admin,
      engagementId,
      builderId,
      kind: "milestone",
      identity: { entity: "milestone", rowId: m.id },
      title: `Milestone — ${m.title}`,
      text: serializeMilestone(m),
    });
  } catch (err) {
    console.error("[syncMilestoneContext]", err);
  }
}

/**
 * Re-sync a task's consolidated context item. Loads the task plus its subtasks,
 * build prompts, and commits, so a change to any child re-mirrors the parent.
 * Personal tasks (no engagement) have nowhere to attach and are skipped.
 */
export async function syncTaskContext(taskId: string, ctx?: SyncCtx): Promise<void> {
  try {
    const admin = ctx?.admin ?? createAdminClient();
    const { data: row } = await admin.from("tasks").select("*").eq("id", taskId).maybeSingle();
    if (!row?.engagement_id) return;
    const engagementId = row.engagement_id as string;
    const builderId = ctx?.builderId ?? (await engagementBuilder(admin, engagementId));
    if (!builderId) return;
    const task = row as Task;

    const [subtasks, prompts, commits, msTitle] = await Promise.all([
      admin.from("task_subtasks").select("*").eq("task_id", taskId).order("position", { ascending: true }),
      admin.from("task_build_prompts").select("variant, prompt, notes").eq("task_id", taskId),
      admin
        .from("task_commits")
        .select("commit_sha, commit_message")
        .eq("task_id", taskId)
        .order("commit_committed_at", { ascending: true }),
      milestoneTitleFor(admin, task.milestone_id),
    ]);

    await syncEntityContext({
      admin,
      engagementId,
      builderId,
      kind: "task",
      identity: { entity: "task", rowId: task.id },
      title: `Task — ${task.title}`,
      text: serializeTask({
        task,
        milestoneTitle: msTitle,
        subtasks: (subtasks.data ?? []) as Subtask[],
        buildPrompts: (prompts.data ?? []) as { variant: string; prompt: string; notes: string | null }[],
        commits: (commits.data ?? []) as { commit_sha: string; commit_message: string | null }[],
      }),
    });
  } catch (err) {
    console.error("[syncTaskContext]", err);
  }
}

/**
 * Resolve the embeddable text for one attachment by type. Text notes use their
 * stored content; links are fetched + extracted (SSRF-guarded, same as
 * syncLinkContent); files are downloaded from the task-attachments bucket and
 * run through the transcript extractor. Non-extractable files (images, zip, …)
 * and failed fetches yield "" — the attachment still becomes a graph node, it's
 * just not RAG-indexed. Best-effort: never throws.
 */
async function resolveAttachmentText(admin: Admin, att: TaskAttachment): Promise<string> {
  if (att.attachment_type === "text") return att.text_content ?? "";

  if (att.attachment_type === "link") {
    if (!att.url) return "";
    const res = await fetchLinkText(att.url);
    return "error" in res ? "" : res.text;
  }

  // file
  if (!att.storage_path) return "";
  const ext = "." + (att.file_name.split(".").pop()?.toLowerCase() ?? "");
  if (!SOP_ALLOWED_EXTENSIONS.has(ext)) return ""; // image / binary — node only
  const { data: blob, error } = await admin.storage
    .from("task-attachments")
    .download(att.storage_path);
  if (error || !blob) return "";
  const file = new File([blob], att.file_name, { type: att.mime_type ?? undefined });
  const extracted = await extractTranscriptText(file);
  return "error" in extracted ? "" : extracted.text;
}

/**
 * Mirror one task attachment's content into the context layer so it's
 * RAG-searchable, keyed by source_meta.rowId = attachmentId (taskId rides along
 * via extraMeta for the graph). Personal tasks (no engagement) are skipped.
 *
 * Attachments are immutable (no UPDATE path), so once a `ready` mirror exists we
 * short-circuit BEFORE any download/fetch — backfill never re-downloads a file
 * or re-fetches a successful link. A missing/failed mirror falls through and
 * (re)tries; a non-extractable file resolves to "" without downloading, so its
 * repeated backfill cost is just one indexed lookup.
 */
export async function syncTaskAttachmentContext(attachmentId: string, ctx?: SyncCtx): Promise<void> {
  try {
    const admin = ctx?.admin ?? createAdminClient();
    const { data: row } = await admin
      .from("task_attachments")
      .select("*")
      .eq("id", attachmentId)
      .maybeSingle();
    if (!row) return;
    const att = row as TaskAttachment;

    const { data: task } = await admin
      .from("tasks")
      .select("id, title, engagement_id")
      .eq("id", att.task_id)
      .maybeSingle();
    if (!task?.engagement_id) return; // personal task — no context layer
    const engagementId = task.engagement_id as string;
    const builderId = ctx?.builderId ?? (await engagementBuilder(admin, engagementId));
    if (!builderId) return;

    // Immutable content: a ready mirror never needs refreshing. Skip before doing
    // any expensive download/fetch.
    const { data: existing } = await admin
      .from("context_items")
      .select("embedding_status")
      .eq("engagement_id", engagementId)
      .eq("source_meta->>source", "auto-entity")
      .eq("source_meta->>entity", "task_attachment")
      .eq("source_meta->>rowId", att.id)
      .maybeSingle();
    if (existing?.embedding_status === "ready") return;

    const body = await resolveAttachmentText(admin, att);
    await syncEntityContext({
      admin,
      engagementId,
      builderId,
      kind: "task_attachment",
      identity: { entity: "task_attachment", rowId: att.id, extraMeta: { taskId: att.task_id } },
      title: `Attachment — ${att.file_name}`,
      text: serializeTaskAttachment({
        attachment: att,
        taskTitle: (task.title as string | null) ?? null,
        body,
      }),
    });
  } catch (err) {
    console.error("[syncTaskAttachmentContext]", err);
  }
}

/**
 * Mirror every engagement-scoped entity that isn't in the context layer yet,
 * refresh those that changed (content-diff skips no-ops), and delete-reconcile
 * orphaned mirrors whose source row is gone. Gap-fill + reconcile only — safe to
 * call on every panel load (mirrors backfillProjectDocuments). Best-effort.
 *
 * Cost note: the first run on a populated engagement embeds many items at once;
 * embedAndStoreChunks goes through assertAiBudget (marks items `failed`, never
 * crashes) and the content-diff guard prevents re-embeds on subsequent loads.
 */
export async function backfillEngagementEntities(
  engagementId: string,
  builderId: string
): Promise<void> {
  try {
    const admin = createAdminClient();
    const ctx: SyncCtx = { admin, builderId };

    const { data: existing } = await admin
      .from("context_items")
      .select("id, source_meta")
      .eq("engagement_id", engagementId)
      .eq("source_meta->>source", "auto-entity");

    const [changeOrders, deliverables, infra, materials, tasks, milestones, briefs] =
      await Promise.all([
        admin.from("change_orders").select("id").eq("engagement_id", engagementId),
        admin.from("deliverables").select("id").eq("engagement_id", engagementId),
        admin.from("infra_recommendations").select("id").eq("engagement_id", engagementId),
        admin.from("context_materials").select("id").eq("engagement_id", engagementId),
        admin.from("tasks").select("id").eq("engagement_id", engagementId),
        admin.from("milestones").select("id").eq("engagement_id", engagementId),
        admin.from("briefs").select("id").eq("engagement_id", engagementId),
      ]);

    const taskIds = (tasks.data ?? []).map((r) => r.id as string);
    // Attachments are keyed by task, not engagement — fetch via the task ids.
    const { data: attachments } = taskIds.length
      ? await admin.from("task_attachments").select("id").in("task_id", taskIds)
      : { data: [] as { id: string }[] };

    const rowIdsByEntity: Record<string, Set<string>> = {
      change_order: new Set((changeOrders.data ?? []).map((r) => r.id as string)),
      deliverable: new Set((deliverables.data ?? []).map((r) => r.id as string)),
      infra: new Set((infra.data ?? []).map((r) => r.id as string)),
      context_material: new Set((materials.data ?? []).map((r) => r.id as string)),
      task: new Set(taskIds),
      task_attachment: new Set((attachments ?? []).map((r) => r.id as string)),
      milestone: new Set((milestones.data ?? []).map((r) => r.id as string)),
      brief: new Set((briefs.data ?? []).map((r) => r.id as string)),
    };

    const jobs: Promise<void>[] = [];
    for (const id of rowIdsByEntity.change_order) jobs.push(syncChangeOrderContext(id, ctx));
    for (const id of rowIdsByEntity.deliverable) jobs.push(syncDeliverableContext(id, ctx));
    for (const id of rowIdsByEntity.infra) jobs.push(syncInfraContext(id, ctx));
    for (const id of rowIdsByEntity.context_material) jobs.push(syncContextMaterialContext(id, ctx));
    for (const id of rowIdsByEntity.task) jobs.push(syncTaskContext(id, ctx));
    for (const id of rowIdsByEntity.task_attachment) jobs.push(syncTaskAttachmentContext(id, ctx));
    for (const id of rowIdsByEntity.milestone) jobs.push(syncMilestoneContext(id, ctx));
    for (const id of rowIdsByEntity.brief) jobs.push(syncBriefContext(id, ctx));
    // Singletons: the wrapper deletes the mirror when the source row is absent.
    jobs.push(syncAgreementContext(engagementId, ctx));
    jobs.push(syncAvailabilityContext(engagementId, ctx));
    jobs.push(syncCodebaseContext(engagementId, ctx));
    await Promise.all(jobs);

    // Reconcile: drop per-row auto-entity mirrors whose source row no longer
    // exists (rows deleted while triggers weren't wired, or any drift). Only
    // touches source:'auto-entity' items — never user notes/links/docs. Entities
    // not in this map (e.g. project_material/project_sop) are reconciled by
    // backfillProjectScopedEntities and skipped here.
    for (const item of existing ?? []) {
      const meta = item.source_meta as { entity?: string; rowId?: string } | null;
      const entity = meta?.entity;
      const rowId = meta?.rowId;
      if (!entity || !rowId) continue; // singletons handled above
      const current = rowIdsByEntity[entity];
      if (current && !current.has(rowId)) {
        await admin.from("context_items").delete().eq("id", item.id as string);
      }
    }
  } catch (err) {
    console.error("[backfillEngagementEntities]", err);
  }
}

/**
 * Mirror the linked repo's AI summaries (latest project profile + branch
 * purposes + recent commit summaries) into one consolidated `codebase` context
 * item. Keyed by engagement (singleton); refreshed on panel-load backfill only,
 * not on every commit-summary generation, to avoid re-embed churn. No repo
 * linked → the mirror is dropped.
 */
export async function syncCodebaseContext(engagementId: string, ctx?: SyncCtx): Promise<void> {
  try {
    const admin = ctx?.admin ?? createAdminClient();
    const builderId = ctx?.builderId ?? (await engagementBuilder(admin, engagementId));
    if (!builderId) return;

    const { data: eng } = await admin
      .from("engagements")
      .select("github_repo_full_name")
      .eq("id", engagementId)
      .maybeSingle();
    const repo = (eng?.github_repo_full_name as string | null) ?? null;

    if (!repo) {
      await syncEntityContext({
        admin,
        engagementId,
        builderId,
        kind: "codebase",
        identity: { entity: "codebase" },
        title: "Codebase",
        text: "",
      });
      return;
    }

    const [profileRes, branchesRes, commitsRes] = await Promise.all([
      admin
        .from("project_profiles")
        .select("summary, audience, current_state, state_rationale, features, services")
        .eq("repo_full_name", repo)
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("branch_purposes")
        .select("branch_name, purpose")
        .eq("repo_full_name", repo)
        .order("generated_at", { ascending: false })
        .limit(20),
      admin
        .from("commit_summaries")
        .select("commit_sha, summary, category")
        .eq("repo_full_name", repo)
        .order("generated_at", { ascending: false })
        .limit(30),
    ]);

    const text = serializeCodebase({
      repoFullName: repo,
      profile: profileRes.data
        ? {
            summary: (profileRes.data.summary as string | null) ?? null,
            audience: (profileRes.data.audience as string | null) ?? null,
            current_state: (profileRes.data.current_state as string | null) ?? null,
            state_rationale: (profileRes.data.state_rationale as string | null) ?? null,
            features: (profileRes.data.features as unknown[] | null) ?? null,
            services: (profileRes.data.services as unknown[] | null) ?? null,
          }
        : null,
      branches: (branchesRes.data ?? []) as { branch_name: string; purpose: string }[],
      commits: (commitsRes.data ?? []) as {
        commit_sha: string;
        summary: string;
        category: string | null;
      }[],
    });

    await syncEntityContext({
      admin,
      engagementId,
      builderId,
      kind: "codebase",
      identity: { entity: "codebase" },
      title: `Codebase — ${repo}`,
      text,
    });
  } catch (err) {
    console.error("[syncCodebaseContext]", err);
  }
}

/**
 * Mirror a linked project's materials and discovery (SOP) transcripts into the
 * engagement's context. These live on the PROJECT, but context is
 * engagement-scoped, so they're only mirrored once the project is linked — the
 * primary path is this panel-load backfill (mirrors backfillProjectDocuments).
 * Gap-fill + reconcile only; best-effort.
 */
export async function backfillProjectScopedEntities(
  engagementId: string,
  projectId: string,
  builderId: string
): Promise<void> {
  try {
    const admin = createAdminClient();

    const [materials, sops] = await Promise.all([
      admin.from("project_materials").select("*").eq("project_id", projectId),
      admin.from("project_sop_transcripts").select("*").eq("project_id", projectId),
    ]);

    const materialIds = new Set((materials.data ?? []).map((r) => r.id as string));
    const sopIds = new Set((sops.data ?? []).map((r) => r.id as string));

    const safe = (p: Promise<void>) => p.catch((err) => console.error("[backfillProjectScoped]", err));
    const jobs: Promise<void>[] = [];
    for (const m of (materials.data ?? []) as ProjectMaterial[]) {
      jobs.push(
        safe(
          syncEntityContext({
            admin,
            engagementId,
            builderId,
            kind: "material",
            identity: { entity: "project_material", rowId: m.id },
            title: `Project material — ${m.label ?? m.file_name ?? "Material"}`,
            text: serializeProjectMaterial(m),
          })
        )
      );
    }
    for (const t of (sops.data ?? []) as ProjectSopTranscript[]) {
      jobs.push(
        safe(
          syncEntityContext({
            admin,
            engagementId,
            builderId,
            kind: "sop",
            identity: { entity: "project_sop", rowId: t.id },
            title: `Discovery transcript — ${t.label ?? "Transcript"}`,
            text: serializeProjectSop(t),
          })
        )
      );
    }
    await Promise.all(jobs);

    // Reconcile orphaned project-scoped mirrors.
    const { data: existing } = await admin
      .from("context_items")
      .select("id, source_meta")
      .eq("engagement_id", engagementId)
      .eq("source_meta->>source", "auto-entity")
      .in("source_meta->>entity", ["project_material", "project_sop"]);
    for (const item of existing ?? []) {
      const meta = item.source_meta as { entity?: string; rowId?: string } | null;
      if (!meta?.rowId) continue;
      const present =
        meta.entity === "project_material"
          ? materialIds.has(meta.rowId)
          : meta.entity === "project_sop"
            ? sopIds.has(meta.rowId)
            : true;
      if (!present) await admin.from("context_items").delete().eq("id", item.id as string);
    }
  } catch (err) {
    console.error("[backfillProjectScopedEntities]", err);
  }
}
