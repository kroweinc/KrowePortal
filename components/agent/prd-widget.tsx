import Link from "next/link";
import { ArrowUpRight, FileText } from "lucide-react";

import { PrdDocument } from "@/components/prd/prd-document";
import type { AgentPrdWidget as AgentPrdWidgetPayload } from "@/lib/agent/types";

// The rendered form of a PRD generation run: the live-assembling (or finished)
// document inside a bordered, scrollable card with a link to the full editor.
// Reuses the exact read-only <PrdDocument> the wizard's live stage uses, so the
// section-by-section fill looks identical. Presentational (no "use client").
//
// Design (DESIGN.md is law): container at --radius-lg, header at --radius-md
// tokens, a Ghost "Open PRD" link at --radius-full — no raw hex/px.
export function AgentPrdWidget({ widget }: { widget: AgentPrdWidgetPayload }) {
  const { title, content, prdId, projectId, sectionsSeen, sectionsTotal } = widget;
  const href = prdId ? `/b/projects/${projectId}/prd/${prdId}` : null;

  return (
    <div className="krowe-ah-prd" role="group" aria-label={title}>
      <div className="krowe-ah-prd-head">
        <span className="krowe-ah-prd-icon" aria-hidden="true">
          <FileText size={14} strokeWidth={2} />
        </span>
        <span className="krowe-ah-prd-title">{title}</span>
        <span className="krowe-ah-prd-meta">
          {prdId ? "Ready" : `Drafting · ${sectionsSeen}/${sectionsTotal}`}
        </span>
      </div>
      <div className="krowe-ah-prd-doc">
        <PrdDocument content={content} />
      </div>
      {href && (
        <Link href={href} className="krowe-ah-prd-open">
          Open PRD
          <ArrowUpRight size={14} aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
