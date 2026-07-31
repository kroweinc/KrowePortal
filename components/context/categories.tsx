import {
  Building2,
  FolderKanban,
  UserCog,
  Hammer,
  FileText,
  Receipt,
  FileSignature,
  GitPullRequestArrow,
  Flag,
  CircleCheck,
  BookMarked,
  Paperclip,
  type LucideIcon,
} from "lucide-react";
import type { GraphNode, ClientGraph } from "@/lib/actions/context-graph";
import type { ContextItem } from "@/lib/types";

/* ============================================================
   Shared context-category metadata. The Graph (canvas discs +
   legend) and the List (grouped rows) both read from here so the
   two views always show the exact same set of categories, colors,
   labels, and one-line descriptors.
   ============================================================ */

export type CatKey =
  | "client"
  | "project"
  | "operator"
  | "builder"
  | "prd"
  | "quote"
  | "contract"
  | "change"
  | "milestone"
  | "task"
  | "attachment"
  | "context";

export interface CatMeta {
  label: string;
  color: string;
  r: number; // canvas disc radius (graph only)
  Icon: LucideIcon;
}

// Category = the node's coloring bucket. Colors / radii / icons mirror the
// design prototype exactly so the map (and list) read the same.
export const CATS: Record<CatKey, CatMeta> = {
  client: { label: "Client", color: "#f97316", r: 19, Icon: Building2 },
  project: { label: "Project", color: "#9b8cff", r: 14, Icon: FolderKanban },
  operator: { label: "Operator", color: "#5b9dff", r: 12, Icon: UserCog },
  builder: { label: "Builder", color: "#ff7a59", r: 12, Icon: Hammer },
  prd: { label: "PRD", color: "#38bdf8", r: 11, Icon: FileText },
  quote: { label: "Quote", color: "#2dd4bf", r: 10, Icon: Receipt },
  contract: { label: "Contract", color: "#818cf8", r: 10, Icon: FileSignature },
  change: { label: "Change order", color: "#f0a830", r: 9, Icon: GitPullRequestArrow },
  milestone: { label: "Milestone", color: "#34d399", r: 9, Icon: Flag },
  task: { label: "Task", color: "#aab0b8", r: 7, Icon: CircleCheck },
  attachment: { label: "Attachment", color: "#c084fc", r: 6, Icon: Paperclip },
  context: { label: "Context", color: "#cdbfa6", r: 8, Icon: BookMarked },
};

// A completed task shifts from the neutral task tint to a clear "done" green —
// the one signal that reads at a glance on the map. Resolve a node's *render*
// color here (not just its category) so the graph disc, focus ring, and detail
// panel swatches all agree.
export const DONE_COLOR = "#22c55e";

export function nodeColor(n: GraphNode): string {
  if (n.type === "task" && n.status === "done") return DONE_COLOR;
  return CATS[catOf(n.group)].color;
}

export const CAT_ORDER: CatKey[] = [
  "client",
  "project",
  "operator",
  "builder",
  "prd",
  "quote",
  "contract",
  "change",
  "milestone",
  "task",
  "attachment",
  "context",
];

// The graph stores `group` as the semantic bucket; only change_order needs a
// rename. Anything unknown (e.g. "brief") falls back to the neutral context tint.
export function catOf(group: string): CatKey {
  if (group === "change_order") return "change";
  if (group === "task_attachment") return "attachment";
  return (group in CATS ? group : "context") as CatKey;
}

export const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const TASK_WORD: Record<string, string> = {
  done: "Done",
  in_progress: "In progress",
  blocked: "Blocked",
  inbox: "Open",
};

// A context_item earns its own standalone graph node (and its own row in the
// List's Context bucket) only when it isn't a *mirror* that folds into another
// node: auto-doc mirrors fold into their document node, profile mirrors into
// their person node, and task/milestone auto-entity mirrors into that node.
// Everything else — pasted notes, links, uploads, SOPs, transcripts, plus the
// brief / change-order entity mirrors that have no node of their own — is
// standalone. Graph and List share this one predicate so they never disagree.
export function isStandaloneContextItem(item: ContextItem): boolean {
  const sm = (item.source_meta as { source?: string; entity?: string } | null) ?? {};
  if (sm.source === "auto-doc" || sm.source === "profile") return false;
  if (
    sm.source === "auto-entity" &&
    (sm.entity === "task" || sm.entity === "milestone" || sm.entity === "task_attachment")
  )
    return false;
  return true;
}

// Reconcile the server-rendered graph with the live, client-side context items
// so an add or delete in the List reflects in the Overview graph instantly —
// without a reload. The server graph stays authoritative for everything EXCEPT
// the standalone context nodes, which we rebuild from the current items (the
// exact set the List shows via isStandaloneContextItem). Stale context edges
// are dropped and re-derived from the live nodes; this mirrors how
// getClientGraph builds those nodes/edges, so a later reload renders identically.
export function buildLiveGraph(base: ClientGraph, items: ContextItem[]): ClientGraph {
  const contextNodes: GraphNode[] = items.filter(isStandaloneContextItem).map((ci) => ({
    id: `context:${ci.id}`,
    type: "contextItem",
    label: ci.title,
    status: ci.embedding_status,
    group: "context",
    meta: { kind: ci.kind },
  }));

  const nodes: GraphNode[] = [
    ...base.nodes.filter((n) => n.type !== "contextItem"),
    ...contextNodes,
  ];
  const nodeIds = new Set(nodes.map((n) => n.id));

  // Keep every non-context edge whose endpoints survive; re-add a center→node
  // edge for each live standalone context item.
  const edges = base.edges.filter(
    (e) =>
      !e.source.startsWith("context:") &&
      !e.target.startsWith("context:") &&
      nodeIds.has(e.source) &&
      nodeIds.has(e.target)
  );
  for (const cn of contextNodes) {
    edges.push({ id: `${base.centerId}->${cn.id}`, source: base.centerId, target: cn.id, kind: "context" });
  }

  return { nodes, edges, centerId: base.centerId };
}

// One-line descriptor under a node's name — synthesized from what we actually
// know (status, kind, milestone progress) since the live data has no free note.
export function noteOf(n: GraphNode): string {
  const cat = catOf(n.group);
  switch (cat) {
    case "client":
      return "This client's workspace — everything Krowe knows, mapped.";
    case "project":
      return "The active build for this client.";
    case "operator":
      return "Operator · runs the engagement day-to-day.";
    case "builder":
      return "Builder · owns delivery on the Krowe side.";
    case "milestone": {
      const done = Number(n.meta?.taskDone ?? 0);
      const total = Number(n.meta?.taskTotal ?? 0);
      return `${done}/${total} tasks done`;
    }
    case "task":
      return n.status ? TASK_WORD[n.status] ?? cap(n.status.replace(/_/g, " ")) : "Task";
    case "attachment":
      return typeof n.meta?.attachmentType === "string"
        ? cap(n.meta.attachmentType as string)
        : "Attachment";
    case "context":
      return typeof n.meta?.kind === "string" ? cap(n.meta.kind as string) : "Context";
    default: {
      // prd / quote / contract / change — surface the document status.
      const s = n.status ? cap(n.status.replace(/_/g, " ")) : "";
      return s ? `${s} · ${CATS[cat].label}` : CATS[cat].label;
    }
  }
}
