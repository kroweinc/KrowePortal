"use client";

import { useMemo, useState } from "react";
import { Share2, List } from "lucide-react";
import { ContextPanel } from "@/components/context/context-panel";
import { ContextGraph } from "@/components/context/context-graph";
import { buildLiveGraph } from "@/components/context/categories";
import type { ClientGraph } from "@/lib/actions/context-graph";
import type { ContextItem } from "@/lib/types";
import "@/components/context/context-graph.css";

// Owns the Graph / List toggle inside the Context tab. Both views stay mounted
// (toggled with `hidden`) so the list's loaded state and the graph's settled
// force simulation survive switching back and forth.
export function ContextView({
  engagementId,
  initialItems,
  graph,
}: {
  engagementId: string;
  initialItems: ContextItem[];
  graph: ClientGraph;
}) {
  const [view, setView] = useState<"graph" | "list">("graph");
  // Whether to surface the RAG-readiness ("Indexed · N") status on items/nodes.
  // Hidden by default — it's plumbing detail most users don't need to see.
  const [showIndex, setShowIndex] = useState(false);

  // Single source of truth for context items, shared by the List (which adds
  // and deletes them) and the Graph. Lifting it here is what lets a delete in
  // the List drop the matching node from the Overview graph immediately —
  // before, the graph held the server-rendered copy and only updated on reload.
  const [items, setItems] = useState<ContextItem[]>(initialItems);
  // The server graph stays authoritative for documents, people, tasks, etc.;
  // we rebuild only the standalone context nodes from the live items so both
  // views always show the same set.
  const liveGraph = useMemo(() => buildLiveGraph(graph, items), [graph, items]);

  return (
    <div className="ctx-view">
      <div className="ctx-view-head">
        <div className="ctx-toggle" role="tablist" aria-label="Context view">
          <button
            type="button"
            role="tab"
            aria-selected={view === "graph"}
            className={`ctx-toggle-btn${view === "graph" ? " is-active" : ""}`}
            onClick={() => setView("graph")}
          >
            <Share2 size={14} strokeWidth={1.9} /> Graph
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "list"}
            className={`ctx-toggle-btn${view === "list" ? " is-active" : ""}`}
            onClick={() => setView("list")}
          >
            <List size={14} strokeWidth={1.9} /> List
          </button>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={showIndex}
          className="ctx-index-toggle"
          onClick={() => setShowIndex((v) => !v)}
        >
          <span>Index status</span>
          <span className={`ctx-sw-track${showIndex ? " on" : ""}`} aria-hidden="true" />
        </button>
      </div>

      <div hidden={view !== "graph"}>
        <ContextGraph graph={liveGraph} engagementId={engagementId} showIndexStatus={showIndex} />
      </div>
      <div hidden={view !== "list"}>
        <ContextPanel
          engagementId={engagementId}
          items={items}
          setItems={setItems}
          graph={liveGraph}
          showIndexStatus={showIndex}
        />
      </div>
    </div>
  );
}
