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

  // Center: the client.
  nodes.push({
    id: centerId,
    type: "client",
    label: (engRow.title as string) || project?.prospect_name || project?.name || "Client",
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
  for (const t of tasks) {
    const id = `task:${t.id}`;
    nodes.push({
      id,
      type: "task",
      label: t.title,
      status: t.status,
      group: "task",
      meta: { status: t.status },
    });
    if (t.milestone_id && milestoneNodeIds.has(t.milestone_id)) {
      addEdge(`milestone:${t.milestone_id}`, id, "task");
    } else {
      addEdge(centerId, id, "task");
    }
  }

  // Context items. Auto-doc items link back to their source document node when present.
  const docNodeIds = new Set(nodes.filter((n) => n.type === "document").map((n) => n.id));
  for (const ci of contextItems) {
    const id = `context:${ci.id}`;
    nodes.push({
      id,
      type: "contextItem",
      label: ci.title,
      status: ci.embedding_status,
      group: "context",
      meta: { kind: ci.kind },
    });
    const sm = (ci.source_meta ?? {}) as { source?: string; docKind?: string; docId?: string };
    const sourceDocId =
      sm.source === "auto-doc" && sm.docKind && sm.docId ? `doc:${sm.docKind}:${sm.docId}` : null;
    if (sourceDocId && docNodeIds.has(sourceDocId)) {
      addEdge(sourceDocId, id, "mirrors");
    } else {
      addEdge(centerId, id, "context");
    }
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
