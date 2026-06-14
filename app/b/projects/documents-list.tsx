"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDownNarrowWide, ChevronRight, Plus } from "lucide-react";
import { Ember } from "@/components/design-atoms";
import { BrandLogo } from "@/components/prd/brand-logo";

// Status as the list surfaces it (lost/archived collapse to "cold").
export type DocStatus = "active" | "won" | "cold";
// One mini-pipeline dot. null = stage not started; otherwise the doc's state.
export type PipeState = "draft" | "sent" | "signed" | "live" | null;

export interface DocRow {
  id: string;
  name: string;
  initials: string;
  tone: "ink" | "clay" | "slate" | "moss";
  website: string | null; // imported business site — drives the brand-logo fetch
  client: string | null;
  status: DocStatus;
  statusLabel: string;
  stageLabel: string | null;
  updated: string;
  pipe: PipeState[]; // always length 4
  pipeLabels: string[]; // always length 4 — stage names for tooltips
  docsDone: number;
}

type Filter = "all" | DocStatus;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "won", label: "Won" },
  { key: "cold", label: "Cold" },
];

export function DocumentsList({
  rows,
  owner,
}: {
  rows: DocRow[];
  owner: { name: string; initials: string };
}) {
  const [filter, setFilter] = useState<Filter>("all");

  const counts: Record<Filter, number> = {
    all: rows.length,
    active: rows.filter((r) => r.status === "active").length,
    won: rows.filter((r) => r.status === "won").length,
    cold: rows.filter((r) => r.status === "cold").length,
  };

  const visible = filter === "all" ? rows : rows.filter((r) => r.status === filter);

  return (
    <>
      <div className="krowe-page-head">
        <div>
          <h1 className="krowe-page-title">
            <Ember size={22} /> Documents
          </h1>
          <div className="krowe-page-sub">
            <span>
              {visible.length} project{visible.length === 1 ? "" : "s"}
            </span>
            <span className="sep">·</span>
            <span className="krowe-quip">
              Prospective businesses you&apos;re preparing documents for.
            </span>
          </div>
        </div>
        <Link href="/b/projects/new" data-tour="new-document" className="krowe-doc-newbtn">
          <Plus width={16} height={16} /> New document
        </Link>
      </div>

      <div className="krowe-filterbar">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`krowe-filter${filter === f.key ? " on" : ""}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label} <span className="fc">{counts[f.key]}</span>
          </button>
        ))}
        <span className="grow" />
        <span className="krowe-sort">
          <ArrowDownNarrowWide width={14} height={14} /> Recently updated
        </span>
      </div>

      {visible.length === 0 ? (
        <DocsEmpty hasAny={rows.length > 0} />
      ) : (
        <div className="krowe-doc-list">
          {visible.map((r) => (
            <Link key={r.id} href={`/b/projects/${r.id}`} className="krowe-doc-card">
              <span className={`krowe-doc-logo ${r.tone}`}>
                <span className="krowe-doc-mono">{r.initials}</span>
                {/* Brand fetch: when a business website was imported, resolve its
                    real logo (Brandfetch → favicon) and let it fill the tile;
                    on a miss the tinted initials below show through. */}
                {r.website && (
                  <BrandLogo domain={r.website} name={r.name} size={52} fallback={r.initials} plain />
                )}
              </span>

              <div className="krowe-doc-body">
                <div className="krowe-doc-titleline">
                  <span className="krowe-doc-name">{r.name}</span>
                  <span className={`krowe-doc-badge ${r.status}`}>
                    <span className="bd" />
                    {r.statusLabel}
                  </span>
                  {r.stageLabel && (
                    <span className="krowe-doc-stage">
                      Stage&nbsp;·&nbsp;<b>{r.stageLabel}</b>
                    </span>
                  )}
                </div>
                <div className="krowe-doc-meta">
                  <span className="who">
                    <span className="mini-av">{owner.initials}</span>
                    {owner.name}
                  </span>
                  {r.client && (
                    <>
                      <span className="dot" />
                      <span>{r.client}</span>
                    </>
                  )}
                  <span className="dot" />
                  <span>{r.updated}</span>
                </div>
              </div>

              <div className="krowe-pipe-wrap">
                <div className="krowe-pipe">
                  {r.pipe.map((s, i) => (
                    <span
                      key={i}
                      className={`pdot${s ? " fill" : ""}`}
                      {...(s ? { "data-c": s } : {})}
                      title={`${r.pipeLabels[i]}${s ? ` · ${s}` : ""}`}
                    />
                  ))}
                </div>
                <span className="krowe-pipe-label">{r.docsDone} of 4 docs</span>
              </div>

              <ChevronRight className="krowe-doc-go" width={18} height={18} />
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

function DocsEmpty({ hasAny }: { hasAny: boolean }) {
  return (
    <div className="krowe-doc-empty">
      <Ember size={40} />
      <p>{hasAny ? "No projects match this filter." : "No projects here yet. What are you preparing for?"}</p>
      <Link href="/b/projects/new" className="krowe-doc-newbtn" style={{ margin: "0 auto" }}>
        <Plus width={16} height={16} /> New document
      </Link>
    </div>
  );
}
