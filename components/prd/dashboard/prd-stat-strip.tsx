"use client";

/* PRD summary strip — three tiles, two derived metrics each: what it costs to
   run, when it lands, and how long it takes to build. Every figure recomputes
   live from the document as the builder edits (see prd-summary.ts). A metric
   with nothing to compute from shows "—" and keeps its label, so a sparse draft
   still renders three intact tiles. */

import { Calendar, CircleCheck, Clock, CodeXml, GitBranch, Quote } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { PrdContent } from "@/lib/types";
import { monthlyCost, buildEstimate, launch } from "./prd-summary";

const DASH = "—";

function StatRow({ icon: Icon, value, label }: { icon: LucideIcon; value: string; label: string }) {
  return (
    <div className="stat-row">
      <span className="stat-row__icon" aria-hidden="true">
        <Icon className="h-4 w-4" />
      </span>
      <span className="stat-row__value">{value}</span>
      <span className="stat-row__label">{label}</span>
    </div>
  );
}

export function PrdStatStrip({ content }: { content: PrdContent }) {
  const cost = monthlyCost(content);
  const est = buildEstimate(content);
  const lc = launch(content);
  const services = (content.techStack?.length ?? 0) + (content.integrations?.length ?? 0);

  return (
    <div className="stat-strip">
      <div className="stat-card">
        <StatRow
          icon={Quote}
          value={cost.display}
          label={cost.unit.includes("est") ? "in est. costs / mo." : "in costs / mo."}
        />
        <StatRow icon={GitBranch} value={String(services)} label={services === 1 ? "service" : "services"} />
      </div>
      <div className="stat-card">
        <StatRow icon={Calendar} value={lc?.due || DASH} label="launch target" />
        <StatRow
          icon={CircleCheck}
          value={String(lc?.count ?? 0)}
          label={lc?.count === 1 ? "milestone to ship" : "milestones to ship"}
        />
      </div>
      <div className="stat-card">
        <StatRow icon={Clock} value={est ? `${est.hours} hours` : DASH} label="in build time" />
        <StatRow
          icon={CodeXml}
          value={est ? `${est.days} ${est.days === 1 ? "day" : "days"}` : DASH}
          label="of solo developing"
        />
      </div>
    </div>
  );
}
