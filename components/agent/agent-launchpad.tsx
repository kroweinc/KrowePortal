"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { launchpadAgents, type AgentDescriptor } from "@/lib/agent/catalog";

// The launchpad grid — one card per catalog agent. Cards are Selection-Card
// surfaces (never filled primary pills): the whole card is the click target and
// the "Start" cue is a ghost affordance, so a grid of N agents doesn't read as N
// primary actions. The single Primary lives in the launch sheet the card opens.

export function AgentLaunchpad({
  noClients,
  onLaunch,
}: {
  noClients: boolean;
  onLaunch: (descriptor: AgentDescriptor) => void;
}) {
  return (
    <section className="krowe-ah-lp-sec">
      <div className="krowe-ah-sec">Start an agent</div>

      {noClients && (
        <div className="krowe-agent-empty">
          <p className="krowe-agent-empty-t">Invite a client to begin</p>
          <p className="krowe-agent-empty-s">
            Most agents reason over a client&apos;s Context Layer — you don&apos;t have any clients yet.
          </p>
          <Link href="/b/engagements" className="krowe-ah-btn">
            Add your first client
          </Link>
        </div>
      )}

      <div className="krowe-ah-lp">
        {launchpadAgents().map((a) => {
          const Icon = a.icon;
          // Client-scoped agents need a client; project-scoped (PRD) can still start
          // from its own picker even with no clients.
          const disabled = noClients && a.scopeKind === "client";
          return (
            <button
              key={a.id}
              type="button"
              className="krowe-ah-lp-card"
              data-engine={a.engine}
              disabled={disabled}
              onClick={() => onLaunch(a)}
              aria-label={`Start ${a.name}`}
            >
              <span className="krowe-ah-lp-ic">
                <Icon size={20} />
              </span>
              <span className="krowe-ah-lp-name">{a.name}</span>
              <span className="krowe-ah-lp-blurb">{a.blurb}</span>
              <span className="krowe-ah-lp-foot">
                <span className="krowe-ah-lp-tag">{a.tag}</span>
                <span className="krowe-ah-lp-go" aria-hidden="true">
                  Start <ArrowRight size={15} className="krowe-ah-lp-go-i" />
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
