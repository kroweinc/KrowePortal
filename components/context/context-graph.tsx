"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { X, ExternalLink } from "lucide-react";
import type { ClientGraph, GraphNode } from "@/lib/actions/context-graph";
import type { DocEventKind } from "@/lib/context/document-events";
import { DocumentTimeline } from "@/components/context/document-timeline";
import "@/components/context/context-graph.css";

// react-force-graph-2d touches window/canvas, so it can't be server-rendered.
// Lazy-load it inside an effect (client-only) — this also preserves ref
// forwarding (zoomToFit) that next/dynamic would drop.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ForceGraphComponent = any;

const GROUP_COLOR: Record<string, string> = {
  client: "#a855f7",
  builder: "#e07a5f",
  operator: "#38bdf8",
  project: "#6366f1",
  prd: "#0ea5e9",
  quote: "#14b8a6",
  contract: "#8b5cf6",
  change_order: "#f59e0b",
  brief: "#ec4899",
  milestone: "#10b981",
  context: "#94a3b8",
  task: "#64748b",
};

const TASK_STATUS_COLOR: Record<string, string> = {
  done: "#10b981",
  in_progress: "#38bdf8",
  blocked: "#ef4444",
  inbox: "#94a3b8",
};

const NODE_R: Record<GraphNode["type"], number> = {
  client: 9,
  project: 7,
  person: 7,
  document: 5.5,
  milestone: 6,
  task: 4,
  contextItem: 4,
};

const LEGEND: { label: string; key: string }[] = [
  { label: "Client", key: "client" },
  { label: "Project", key: "project" },
  { label: "Builder", key: "builder" },
  { label: "Operator", key: "operator" },
  { label: "PRD", key: "prd" },
  { label: "Quote", key: "quote" },
  { label: "Contract", key: "contract" },
  { label: "Change order", key: "change_order" },
  { label: "Milestone", key: "milestone" },
  { label: "Task", key: "task" },
  { label: "Context", key: "context" },
];

function colorForNode(node: GraphNode): string {
  if (node.type === "task") return TASK_STATUS_COLOR[node.status ?? "inbox"] ?? "#64748b";
  return GROUP_COLOR[node.group] ?? "#94a3b8";
}

export function ContextGraph({
  graph,
  engagementId,
}: {
  graph: ClientGraph;
  engagementId: string;
}) {
  const [FG, setFG] = useState<ForceGraphComponent | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);
  const didZoom = useRef(false);

  // Lazy-load the canvas library on the client.
  useEffect(() => {
    let active = true;
    import("react-force-graph-2d").then((m) => {
      if (active) setFG(() => m.default);
    });
    return () => {
      active = false;
    };
  }, []);

  // Size the canvas to its container.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Build the library's { nodes, links } shape. Clone nodes so the simulation's
  // x/y mutations don't touch the server-provided props across re-renders.
  const data = useMemo(
    () => ({
      nodes: graph.nodes.map((n) => ({ ...n })),
      links: graph.edges.map((e) => ({ source: e.source, target: e.target, kind: e.kind })),
    }),
    [graph]
  );

  // Adjacency for hover-neighbor highlighting.
  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const e of graph.edges) {
      if (!map.has(e.source)) map.set(e.source, new Set());
      if (!map.has(e.target)) map.set(e.target, new Set());
      map.get(e.source)!.add(e.target);
      map.get(e.target)!.add(e.source);
    }
    return map;
  }, [graph]);

  const highlight = useMemo(() => {
    if (!hoverId) return null;
    const set = new Set<string>([hoverId]);
    for (const n of neighbors.get(hoverId) ?? []) set.add(n);
    return set;
  }, [hoverId, neighbors]);

  // Re-fit when graph identity changes.
  useEffect(() => {
    didZoom.current = false;
  }, [graph]);

  const hasNodes = graph.nodes.length > 0;

  return (
    <div className="ctx-graph-wrap" ref={wrapRef}>
      {!hasNodes && (
        <div className="ctx-graph-empty">
          Nothing to map yet — once this client has documents, tasks, or context, they&apos;ll appear here.
        </div>
      )}

      {hasNodes && FG && size.w > 0 && (
        <FG
          ref={fgRef}
          graphData={data}
          width={size.w}
          height={size.h}
          backgroundColor="rgba(0,0,0,0)"
          cooldownTicks={120}
          d3VelocityDecay={0.3}
          nodeRelSize={1}
          nodeLabel={(n: GraphNode) => n.label}
          onNodeHover={(n: GraphNode | null) => setHoverId(n?.id ?? null)}
          onNodeClick={(n: GraphNode) => setSelected(n)}
          onBackgroundClick={() => setSelected(null)}
          onEngineStop={() => {
            if (!didZoom.current && fgRef.current) {
              didZoom.current = true;
              fgRef.current.zoomToFit(400, 48);
            }
          }}
          linkColor={(l: { source: GraphNode | string; target: GraphNode | string }) => {
            if (!highlight) return "rgba(255,255,255,0.12)";
            const s = typeof l.source === "object" ? l.source.id : l.source;
            const t = typeof l.target === "object" ? l.target.id : l.target;
            return highlight.has(s) && highlight.has(t)
              ? "rgba(255,255,255,0.4)"
              : "rgba(255,255,255,0.05)";
          }}
          linkWidth={1}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
            const r = NODE_R[node.type as GraphNode["type"]] ?? 4;
            const dim = highlight ? !highlight.has(node.id) : false;
            ctx.globalAlpha = dim ? 0.15 : 1;

            ctx.beginPath();
            ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
            ctx.fillStyle = colorForNode(node as GraphNode);
            ctx.fill();

            if (selected?.id === node.id) {
              ctx.lineWidth = 2 / globalScale;
              ctx.strokeStyle = "#ffffff";
              ctx.stroke();
            }

            const showLabel = globalScale > 0.8 || node.type === "client" || node.type === "project";
            if (showLabel) {
              const fontSize = Math.max(10 / globalScale, 2.4);
              ctx.font = `${fontSize}px var(--font-sans, sans-serif)`;
              ctx.textAlign = "center";
              ctx.textBaseline = "top";
              ctx.fillStyle = dim ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.82)";
              const label = String(node.label ?? "");
              const text = label.length > 30 ? label.slice(0, 29) + "…" : label;
              ctx.fillText(text, node.x, node.y + r + 1.5);
            }
            ctx.globalAlpha = 1;
          }}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
            const r = NODE_R[node.type as GraphNode["type"]] ?? 4;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(node.x, node.y, r + 2, 0, 2 * Math.PI);
            ctx.fill();
          }}
        />
      )}

      {/* Legend */}
      {hasNodes && (
        <div className="ctx-legend ctx-glass">
          <div className="ctx-legend-title">Legend</div>
          <div className="ctx-legend-grid">
            {LEGEND.map((l) => (
              <span key={l.key} className="ctx-legend-item">
                <span className="ctx-legend-dot" style={{ background: GROUP_COLOR[l.key] }} />
                {l.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Selection panel */}
      {selected && (
        <div className="ctx-graph-panel ctx-glass">
          <button
            type="button"
            className="ctx-panel-close"
            onClick={() => setSelected(null)}
            aria-label="Close"
          >
            <X size={16} strokeWidth={2} />
          </button>

          <div className="ctx-panel-head">
            <span className="ctx-panel-kind">
              {selected.type === "document"
                ? String((selected.meta?.docKind as string) ?? "document")
                : selected.type}
            </span>
            <span className="ctx-panel-title">{selected.label}</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {selected.status && <span className="chip chip-kind">{selected.status}</span>}
              {typeof selected.meta?.kind === "string" && (
                <span className="chip chip-kind">{selected.meta.kind as string}</span>
              )}
            </div>
            {typeof selected.meta?.href === "string" && (
              <Link href={selected.meta.href as string} className="ctx-panel-link">
                <ExternalLink size={13} strokeWidth={2} /> Open
              </Link>
            )}
          </div>

          {selected.type === "document" && selected.meta?.docId ? (
            <DocumentTimeline
              docKind={selected.meta.docKind as DocEventKind}
              docId={selected.meta.docId as string}
              engagementId={engagementId}
            />
          ) : selected.type === "milestone" ? (
            <div className="ctx-panel-meta">
              {Number(selected.meta?.taskDone ?? 0)} / {Number(selected.meta?.taskTotal ?? 0)} tasks done
            </div>
          ) : selected.type === "task" ? (
            <div className="ctx-panel-meta">Status: {selected.status}</div>
          ) : null}
        </div>
      )}
    </div>
  );
}
