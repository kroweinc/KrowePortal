"use client";

/* PRD dashboard summary strip — three at-a-glance cards: estimated monthly
   cost, launch target, and estimated build time. */

import type { PrdContent } from "@/lib/types";
import { monthlyCost, buildEstimate, launch } from "./prd-summary";

export function PrdStatStrip({ content }: { content: PrdContent }) {
  const cost = monthlyCost(content);
  const est = buildEstimate(content);
  const lc = launch(content);

  return (
    <div className="stat-strip">
      <div className="stat-card">
        <p className="stat-card__label">Est. monthly cost</p>
        <p className="stat-card__value">
          <span className="stat-card__num">{cost.display}</span>
          <span className="stat-card__unit">{cost.unit}</span>
        </p>
        <p className="stat-card__sub">{cost.sub}</p>
      </div>
      <div className="stat-card">
        <p className="stat-card__label">Launch target</p>
        <p className="stat-card__value">
          <span className="stat-card__num">{lc ? lc.due || "—" : "—"}</span>
        </p>
        <p className="stat-card__sub">{lc ? lc.count : 0} milestones to ship</p>
      </div>
      <div className="stat-card">
        <p className="stat-card__label">Est. build time</p>
        <p className="stat-card__value">
          <span className="stat-card__num">{est ? est.hours : "—"}</span>
          {est && <span className="stat-card__unit">hrs</span>}
        </p>
        <p className="stat-card__sub">
          {est
            ? `solo dev w/ Claude Code · ~${est.days} ${est.days === 1 ? "day" : "days"}`
            : "Add features to estimate"}
        </p>
      </div>
    </div>
  );
}
