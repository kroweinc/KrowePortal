"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { getClient, assertEngagementBuilder } from "@/lib/context/access";
import { getPrdsByProject } from "@/lib/actions/prds";
import { getQuotesByProject } from "@/lib/actions/quote-docs";
import { getContractsByProject } from "@/lib/actions/contracts";
import { getChangeOrders } from "@/lib/actions/change-orders";
import { getContextItems } from "@/lib/actions/context";
import { getMilestonesForEngagement, getEngagementTaskStream } from "@/lib/actions/milestones";
import {
  recordDocumentEvent,
  type DocEventKind,
  type DocEventType,
  type DocActorRole,
} from "@/lib/context/document-events";
import type { ProfileRole, ProfileFieldChange } from "@/lib/context/profile-events";
import { humanDuration } from "@/lib/context/duration";
import {
  getEngagementTimeline,
  type EngagementTimeline,
  type EntityLifecycle,
} from "@/lib/context/lifecycle-analytics";
import type { ContextItem } from "@/lib/types";

// ============================================================
// Context graph — assemble everything known about a client (engagement) into a
// node/edge graph for the Obsidian-style overview, and read/write the
// per-document event timeline. Builder-only; all reads reuse the existing
// owner-scoped action helpers.
// ============================================================

export type GraphNodeType =
  | "client"
  | "project"
  | "person"
  | "document"
  | "contextItem"
  | "task"
  | "attachment"
  | "milestone";

export interface GraphNode {
  id: string; // namespaced, e.g. "client:<eid>", "doc:prd:<uuid>", "task:<uuid>"
  type: GraphNodeType;
  label: string;
  status?: string | null;
  group: string; // coloring bucket
  meta?: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: string;
}

export interface ClientGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  centerId: string;
}

const DOC_ROUTE: Record<"prd" | "quote" | "contract", string> = {
  prd: "prd",
  quote: "quotes",
  contract: "contract",
};

// How much of an auto-doc mirror's text to inline on its document node so the
// node detail panel can preview what's actually in the AI's context.
const CONTEXT_PREVIEW_CHARS = 600;

// The auto-doc mirror data folded onto a document node's meta (read by the
// graph's node-detail "In AI context" section). Mirrors what we know about the
// context_item that carries this document's embedded text.
export interface SyncedContextMeta {
  itemId: string;
  embeddingStatus: ContextItem["embedding_status"];
  chunkCount: number;
  charCount: number | null;
  preview: string;
}

// A labeled cross-document link folded onto a document node's meta so the
// node-detail panel can NAME the relationship instead of leaving it a bare edge.
// Used for quote↔PRD provenance: `sourcePrd` (the PRD a quote was priced from)
// on the quote node, and `derivedQuotes` (the quotes priced from it) on the PRD.
export interface DocLinkRef {
  nodeId: string; // the linked document's graph node id, e.g. "doc:prd:<uuid>"
  title: string;
  status: string | null;
}

// Completion context folded onto a *done* task node's meta: how long it took
// (created → completed), the deliverable materials attached on done, and the
// commit messages linked at sign-off. Surfaced in the graph's node-detail
// "Completed" section; its presence also recolors the disc green.
export interface TaskCompletionMeta {
  createdAt: string;
  completedAt: string | null;
  durationLabel: string | null; // human "how long from created to done"
  note: string | null; // completion_note
  pushedToMain: boolean;
  deliverables: { name: string; type: string; url: string | null }[];
  commits: { shortSha: string; message: string; url: string | null }[];
}

export async function getClientGraph(engagementId: string): Promise<ClientGraph> {
  const empty: ClientGraph = { nodes: [], edges: [], centerId: `client:${engagementId}` };

  const profile = await getCurrentProfile();
  if (!profile) return empty;
  if (!(await assertEngagementBuilder(engagementId, profile.id))) return empty;

  // Engagement + joined names. Read via admin (mirrors the engagement page):
  // profiles_select RLS hides the operator's row from the builder, so the
  // authed client would return a null operator embed. Ownership is already
  // proven by assertEngagementBuilder above.
  const admin = createAdminClient();
  const { data } = await admin
    .from("engagements")
    .select(
      "id, title, project_id, builder_id, operator_id, builder:profiles!builder_id(display_name), operator:profiles!operator_id(display_name), project:projects(id, name, prospect_name)"
    )
    .eq("id", engagementId)
    .maybeSingle();
  if (!data) return empty;

  // Supabase infers embedded relations as arrays; this query is to-one, so cast.
  const engRow = data as unknown as {
    id: string;
    title: string;
    project_id: string | null;
    builder: { display_name: string | null } | null;
    operator: { display_name: string | null } | null;
    project: { id: string; name: string; prospect_name: string | null } | null;
  };

  const project = engRow.project;
  const builderName = engRow.builder?.display_name ?? "You";
  const operatorName = engRow.operator?.display_name ?? null;
  const projectId = engRow.project_id ?? null;

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const centerId = `client:${engagementId}`;

  const addEdge = (source: string, target: string, kind: string) =>
    edges.push({ id: `${source}->${target}`, source, target, kind });

  // Center: the client. This node is the overview root of the graph, so it
  // reads "Overview" rather than echoing the engagement/client name.
  nodes.push({
    id: centerId,
    type: "client",
    label: "Overview",
    group: "client",
    meta: { engagementId },
  });

  // People.
  const builderId = `person:builder`;
  nodes.push({ id: builderId, type: "person", label: builderName, group: "builder" });
  addEdge(centerId, builderId, "builder");
  if (operatorName) {
    const opId = `person:operator`;
    nodes.push({ id: opId, type: "person", label: operatorName, group: "operator" });
    addEdge(centerId, opId, "operator");
  }

  // Project being built.
  let projectNodeId: string | null = null;
  if (project) {
    projectNodeId = `project:${project.id}`;
    nodes.push({
      id: projectNodeId,
      type: "project",
      label: project.name || project.prospect_name || "Project",
      group: "project",
      meta: { projectId: project.id, href: `/b/projects/${project.id}` },
    });
    addEdge(centerId, projectNodeId, "project");
  }

  // Fetch the rest in parallel — all owner/builder-scoped reuse of existing actions.
  const [prds, quotes, contracts, changeOrders, contextItems, milestones, tasks] = await Promise.all([
    projectId ? getPrdsByProject(projectId) : Promise.resolve([]),
    projectId ? getQuotesByProject(projectId) : Promise.resolve([]),
    projectId ? getContractsByProject(projectId) : Promise.resolve([]),
    getChangeOrders(engagementId),
    getContextItems(engagementId),
    getMilestonesForEngagement(engagementId),
    getEngagementTaskStream(engagementId),
  ]);

  // Project-scoped documents hang off the project node (fall back to client).
  const docParent = projectNodeId ?? centerId;
  const addProjectDoc = (
    kind: "prd" | "quote" | "contract",
    rows: { id: string; title: string; status: string }[]
  ) => {
    for (const d of rows) {
      const id = `doc:${kind}:${d.id}`;
      nodes.push({
        id,
        type: "document",
        label: d.title,
        status: d.status,
        group: kind,
        meta: {
          docKind: kind,
          docId: d.id,
          href: projectId ? `/b/projects/${projectId}/${DOC_ROUTE[kind]}/${d.id}` : null,
        },
      });
      addEdge(docParent, id, kind);
    }
  };
  addProjectDoc("prd", prds);
  addProjectDoc("quote", quotes);
  addProjectDoc("contract", contracts);

  // Quote → PRD provenance. A quote drafted from a PRD records that PRD in
  // quotes.source_prd_id; surface it as context: draw the edge so the map shows
  // the relationship, and fold a labeled reference onto BOTH nodes' meta so the
  // detail panel can name it — "Generated from" on the quote, "Quotes priced
  // from this" on the PRD — rather than leaving it an unlabeled connection.
  // Skipped when the source PRD was deleted (set null) or sits outside this
  // project's node set.
  const projectDocById = new Map(
    nodes.filter((n) => n.type === "document").map((n) => [n.id, n] as const)
  );
  for (const q of quotes) {
    if (!q.source_prd_id) continue;
    const prdNodeId = `doc:prd:${q.source_prd_id}`;
    const quoteNodeId = `doc:quote:${q.id}`;
    const prdNode = projectDocById.get(prdNodeId);
    const quoteNode = projectDocById.get(quoteNodeId);
    if (!prdNode || !quoteNode) continue;
    addEdge(prdNodeId, quoteNodeId, "source_prd");
    quoteNode.meta = {
      ...quoteNode.meta,
      sourcePrd: { nodeId: prdNodeId, title: prdNode.label, status: prdNode.status ?? null },
    };
    const priorQuotes = (prdNode.meta?.derivedQuotes as DocLinkRef[] | undefined) ?? [];
    prdNode.meta = {
      ...prdNode.meta,
      derivedQuotes: [
        ...priorQuotes,
        { nodeId: quoteNodeId, title: quoteNode.label, status: quoteNode.status ?? null },
      ],
    };
  }

  // Change orders are engagement-scoped.
  for (const co of changeOrders) {
    const id = `doc:change_order:${co.id}`;
    nodes.push({
      id,
      type: "document",
      label: co.title,
      status: co.status,
      group: "change_order",
      meta: { docKind: "change_order", docId: co.id, href: null },
    });
    addEdge(centerId, id, "change_order");
  }

  // Milestones + tasks.
  const milestoneNodeIds = new Set<string>();
  for (const m of milestones) {
    const id = `milestone:${m.id}`;
    milestoneNodeIds.add(m.id);
    nodes.push({
      id,
      type: "milestone",
      label: m.title,
      status: m.status,
      group: "milestone",
      meta: { taskTotal: m.taskTotal, taskDone: m.taskDone },
    });
    addEdge(centerId, id, "milestone");
  }
  // Completion context for done tasks — batch the deliverable materials and
  // linked commit messages so each done node can carry "what shipped". Scoped
  // by the engagement's own task ids (builder ownership already asserted).
  const doneTaskIds = tasks.filter((t) => t.status === "done").map((t) => t.id);
  const deliverablesByTask = new Map<string, TaskCompletionMeta["deliverables"]>();
  const commitsByTask = new Map<string, TaskCompletionMeta["commits"]>();
  if (doneTaskIds.length) {
    const [attRes, commitRes] = await Promise.all([
      admin
        .from("task_attachments")
        .select("task_id, file_name, attachment_type, url")
        .in("task_id", doneTaskIds)
        .eq("is_deliverable", true),
      admin
        .from("task_commits")
        .select("task_id, commit_sha, commit_message, commit_url, commit_committed_at")
        .in("task_id", doneTaskIds)
        .order("commit_committed_at", { ascending: true }),
    ]);
    for (const a of (attRes.data ?? []) as {
      task_id: string;
      file_name: string;
      attachment_type: string;
      url: string | null;
    }[]) {
      const list = deliverablesByTask.get(a.task_id) ?? [];
      list.push({ name: a.file_name, type: a.attachment_type, url: a.url });
      deliverablesByTask.set(a.task_id, list);
    }
    for (const c of (commitRes.data ?? []) as {
      task_id: string;
      commit_sha: string;
      commit_message: string | null;
      commit_url: string | null;
    }[]) {
      const list = commitsByTask.get(c.task_id) ?? [];
      list.push({
        shortSha: c.commit_sha.slice(0, 7),
        message: (c.commit_message ?? "").split("\n")[0].slice(0, 200),
        url: c.commit_url,
      });
      commitsByTask.set(c.task_id, list);
    }
  }

  for (const t of tasks) {
    const id = `task:${t.id}`;
    // taskId lets the node-detail panel lazy-load this task's full stage history
    // (created → in progress → … → done) on click, the same way document nodes
    // carry docId for their timeline.
    const meta: Record<string, unknown> = { status: t.status, taskId: t.id };
    if (t.status === "done") {
      const completion: TaskCompletionMeta = {
        createdAt: t.created_at,
        completedAt: t.completed_at,
        durationLabel: t.completed_at
          ? humanDuration(new Date(t.completed_at).getTime() - new Date(t.created_at).getTime())
          : null,
        note: t.completion_note,
        pushedToMain: t.pushed_to_main,
        deliverables: deliverablesByTask.get(t.id) ?? [],
        commits: commitsByTask.get(t.id) ?? [],
      };
      meta.completion = completion;
    }
    nodes.push({
      id,
      type: "task",
      label: t.title,
      status: t.status,
      group: "task",
      meta,
    });
    if (t.milestone_id && milestoneNodeIds.has(t.milestone_id)) {
      addEdge(`milestone:${t.milestone_id}`, id, "task");
    } else {
      addEdge(centerId, id, "task");
    }
  }

  // Task attachments — every file/link/note on a task is its own leaf node edged
  // ONLY to its parent task. Built from the raw rows (independent of embedding) so
  // non-extractable files (images, etc.) still show as references; the auto-entity
  // mirror of an extractable attachment folds onto this node in the loop below.
  const taskNodeIds = new Set(tasks.map((t) => `task:${t.id}`));
  if (tasks.length) {
    const { data: attachments } = await admin
      .from("task_attachments")
      .select("id, task_id, file_name, attachment_type, url, is_deliverable")
      .in(
        "task_id",
        tasks.map((t) => t.id)
      );
    for (const a of (attachments ?? []) as {
      id: string;
      task_id: string;
      file_name: string;
      attachment_type: string;
      url: string | null;
      is_deliverable: boolean;
    }[]) {
      const parent = `task:${a.task_id}`;
      if (!taskNodeIds.has(parent)) continue;
      const id = `attachment:${a.id}`;
      nodes.push({
        id,
        type: "attachment",
        label: a.file_name,
        group: "task_attachment",
        meta: {
          attachmentId: a.id,
          attachmentType: a.attachment_type,
          url: a.url,
          isDeliverable: a.is_deliverable,
        },
      });
      addEdge(parent, id, "attachment");
    }
  }

  // Context items. An auto-doc item mirrors a project document (PRD/quote/
  // contract) — rather than draw it as its own node, fold the mirror INTO its
  // source document node so the document's embedding status + a text preview
  // surface inside that node's detail panel. Standalone context — notes, links,
  // uploads, SOPs, transcripts — keeps its own node hanging off the client.
  const docNodeById = new Map(
    nodes.filter((n) => n.type === "document").map((n) => [n.id, n] as const)
  );
  // Profile mirrors fold onto their person node by role, the same way auto-doc
  // mirrors fold onto their document node.
  const personNodeById = new Map(
    nodes.filter((n) => n.type === "person").map((n) => [n.id, n] as const)
  );
  // Auto-entity mirrors of a task/milestone fold onto that same node (it already
  // has a first-class node), so a task is ONE node carrying its status + history
  // AND its AI-context preview — never a second "context" twin.
  const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
  const syncedFrom = (ci: ContextItem): SyncedContextMeta => ({
    itemId: ci.id,
    embeddingStatus: ci.embedding_status,
    chunkCount: ci.chunk_count,
    charCount: ci.char_count,
    preview: (ci.content ?? "").slice(0, CONTEXT_PREVIEW_CHARS),
  });
  for (const ci of contextItems) {
    const sm = (ci.source_meta ?? {}) as {
      source?: string;
      docKind?: string;
      docId?: string;
      role?: string;
      entity?: string;
      rowId?: string;
    };

    // Profile mirror (builder/operator): attach to its person node. Never a
    // standalone node; skip silently if that person isn't on the graph (e.g.
    // no operator linked yet).
    if (sm.source === "profile") {
      const personId = sm.role === "operator" ? "person:operator" : "person:builder";
      const personNode = sm.role === "builder" || sm.role === "operator"
        ? personNodeById.get(personId)
        : undefined;
      if (personNode) personNode.meta = { ...personNode.meta, syncedContext: syncedFrom(ci) };
      continue;
    }

    // Auto-entity mirror of a task / milestone / task attachment: fold onto that
    // node, the same way auto-doc mirrors fold onto their document node. Falls
    // through to a standalone node only if the source row's node isn't on the
    // graph (orphan). Attachments live under the `attachment:` namespace.
    if (
      sm.source === "auto-entity" &&
      sm.rowId &&
      (sm.entity === "task" || sm.entity === "milestone" || sm.entity === "task_attachment")
    ) {
      const nodeKey =
        sm.entity === "task_attachment" ? `attachment:${sm.rowId}` : `${sm.entity}:${sm.rowId}`;
      const entityNode = nodeById.get(nodeKey);
      if (entityNode) {
        entityNode.meta = { ...entityNode.meta, syncedContext: syncedFrom(ci) };
        continue;
      }
    }

    const sourceDocId =
      sm.source === "auto-doc" && sm.docKind && sm.docId ? `doc:${sm.docKind}:${sm.docId}` : null;
    const docNode = sourceDocId ? docNodeById.get(sourceDocId) : undefined;

    // Mirror of a document we're rendering: attach it, no separate node/edge.
    if (docNode) {
      docNode.meta = { ...docNode.meta, syncedContext: syncedFrom(ci) };
      continue;
    }

    // Standalone knowledge (or an orphan mirror whose document isn't shown).
    const id = `context:${ci.id}`;
    nodes.push({
      id,
      type: "contextItem",
      label: ci.title,
      status: ci.embedding_status,
      group: "context",
      meta: { kind: ci.kind },
    });
    addEdge(centerId, id, "context");
  }

  return { nodes, edges, centerId };
}

// ── Per-document event timeline ─────────────────────────────────────────────

export interface DocumentEventRow {
  id: string;
  event_type: DocEventType;
  actor_role: DocActorRole | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export async function getDocumentEvents(
  docKind: DocEventKind,
  docId: string,
  engagementId: string
): Promise<DocumentEventRow[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];
  if (!(await assertEngagementBuilder(engagementId, profile.id))) return [];

  const supabase = await getClient(profile.id);
  const { data } = await supabase
    .from("document_events")
    .select("id, event_type, actor_role, payload, created_at")
    .eq("doc_kind", docKind)
    .eq("doc_id", docId)
    .eq("engagement_id", engagementId)
    .order("created_at", { ascending: true });

  return (data ?? []) as DocumentEventRow[];
}

// ── Per-person profile change history ───────────────────────────────────────

// One recorded profile update on a builder/operator person node: the field-level
// diff (what changed and what it was before) plus when. Powers the "History"
// section on the person nodes — fed by recordProfileEvent at profile-sync time.
export interface ProfileEventRow {
  id: string;
  role: ProfileRole;
  changes: ProfileFieldChange[];
  created_at: string;
}

export async function getProfileEvents(
  engagementId: string,
  role: ProfileRole
): Promise<ProfileEventRow[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];
  if (!(await assertEngagementBuilder(engagementId, profile.id))) return [];

  const supabase = await getClient(profile.id);
  const { data } = await supabase
    .from("profile_events")
    .select("id, role, payload, created_at")
    .eq("engagement_id", engagementId)
    .eq("role", role)
    .order("created_at", { ascending: false });

  return ((data ?? []) as {
    id: string;
    role: ProfileRole;
    payload: { changes?: ProfileFieldChange[] } | null;
    created_at: string;
  }[]).map((r) => ({
    id: r.id,
    role: r.role,
    changes: r.payload?.changes ?? [],
    created_at: r.created_at,
  }));
}

// ── Project / engagement-wide activity history ──────────────────────────────

// The whole project's lifecycle story for the project node's "History" section:
// every document event, task stage transition, and relationship milestone in one
// chronological feed, plus the engagement timing rollups. A thin client-callable
// wrapper over the server-only loader — which already asserts builder ownership —
// the same unifier the AI context layer reads from.
export async function getProjectActivity(engagementId: string): Promise<EngagementTimeline> {
  return getEngagementTimeline(engagementId);
}

// ── Per-task stage history ──────────────────────────────────────────────────

// One task's full lifecycle for the task node's "History" section: every stage
// transition (created → in progress → blocked → sent for approval → approved →
// done), with the gap since the previous stage and the total elapsed. Reuses the
// engagement unifier — which already labels, dedupes the approval handshake, and
// fills the inter-stage gaps — then plucks just this task's lifecycle, so the
// panel reads exactly what the project history and the AI context layer see.
// Returns null for a task with no recorded transitions (e.g. created before the
// task audit log existed). Builder-only; getEngagementTimeline asserts ownership.
export async function getTaskHistory(
  engagementId: string,
  taskId: string
): Promise<EntityLifecycle | null> {
  const { lifecycles } = await getEngagementTimeline(engagementId);
  return lifecycles.find((l) => l.kind === "task" && l.entityId === taskId) ?? null;
}

const CHANGE_REQUEST_MAX = 5000;

export async function logChangeRequest(
  docKind: DocEventKind,
  docId: string,
  engagementId: string,
  changesText: string
): Promise<{ success: true } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") return { error: "Only the builder can log change requests." };
  if (!(await assertEngagementBuilder(engagementId, profile.id))) return { error: "Not your client." };

  const text = (changesText ?? "").trim();
  if (!text) return { error: "Describe the requested changes." };
  if (text.length > CHANGE_REQUEST_MAX) return { error: "That's too long — keep it under 5000 characters." };

  await recordDocumentEvent({
    docKind,
    docId,
    engagementId,
    eventType: "changes_requested",
    actorId: profile.id,
    actorRole: "builder",
    payload: { changesText: text.slice(0, CHANGE_REQUEST_MAX) },
  });

  revalidatePath(`/b/engagements/${engagementId}`);
  return { success: true };
}
