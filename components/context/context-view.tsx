"use client";

import { useState } from "react";
import { Network, List } from "lucide-react";
import { ContextPanel } from "@/components/context/context-panel";
import { ContextGraph } from "@/components/context/context-graph";
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

  return (
    <div className="ctx-view">
      <div className="ctx-toggle" role="tablist" aria-label="Context view">
        <button
          type="button"
          role="tab"
          aria-selected={view === "graph"}
          className={`ctx-toggle-btn${view === "graph" ? " is-active" : ""}`}
          onClick={() => setView("graph")}
        >
          <Network size={14} strokeWidth={1.9} /> Graph
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

      <div hidden={view !== "graph"}>
        <ContextGraph graph={graph} engagementId={engagementId} />
      </div>
      <div hidden={view !== "list"}>
        <ContextPanel engagementId={engagementId} initialItems={initialItems} />
      </div>
    </div>
  );
}
