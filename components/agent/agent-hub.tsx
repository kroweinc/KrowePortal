"use client";

import * as React from "react";

import { useAgentRunsSummary } from "@/components/agent/agent-runs-provider";
import { AgentLaunchpad } from "@/components/agent/agent-launchpad";
import { AgentLaunchSheet } from "@/components/agent/agent-launch-sheet";
import { AgentActivityFeed } from "@/components/agent/agent-activity-feed";
import { isActiveStatus } from "@/lib/agent/feed";
import type { AgentDescriptor } from "@/lib/agent/catalog";
import type { ActiveRun } from "@/lib/agent/types";

// The Agents Hub — the full-page home the dock's "View all" lands on. A launchpad
// of the catalog's named agents (each riding the existing chat/prd engines) on top,
// then a cross-client activity feed of every run (active + history) below. Scope is
// chosen per launch, so the hub itself is global — it never pins one client.

/** A client the launchpad's chat agents and the feed's filter address. `name` is
    resolved server-side (prospect → project → engagement title) to match the feed. */
export interface HubEngagement {
  id: string;
  name: string;
}

/** A project the PRD agent can target. */
export interface HubProject {
  id: string;
  name: string;
}

/** The live "N running" pip beside the title — subscribes to the run store so the
    head reflects in-flight work the moment it starts, and goes quiet at zero. */
function LiveRunningCount() {
  const live = useAgentRunsSummary();
  const running = live.filter((l) => isActiveStatus(l.status)).length;
  if (running === 0) {
    return <span className="krowe-ah-live" data-quiet="true">All quiet</span>;
  }
  return (
    <span className="krowe-ah-live">
      <span className="krowe-ah-pip" />
      {running} running
    </span>
  );
}

export function AgentHub({
  engagements,
  projects,
  initialHistory,
}: {
  engagements: HubEngagement[];
  projects: HubProject[];
  initialHistory: ActiveRun[];
}) {
  // The agent whose launch sheet is open, or null. One sheet at a time.
  const [launching, setLaunching] = React.useState<AgentDescriptor | null>(null);

  return (
    <div className="krowe-ah-hub">
      <header className="krowe-page-head">
        <div>
          <h1 className="krowe-page-title">Agents</h1>
          <div className="krowe-page-sub">
            <LiveRunningCount />
            <span className="sep">·</span>
            <span className="krowe-quip">Hand off the busywork — watch every run land here.</span>
          </div>
        </div>
      </header>

      <AgentLaunchpad noClients={engagements.length === 0} onLaunch={setLaunching} />

      {launching && (
        <AgentLaunchSheet
          descriptor={launching}
          engagements={engagements}
          projects={projects}
          onClose={() => setLaunching(null)}
        />
      )}

      <AgentActivityFeed engagements={engagements} initialHistory={initialHistory} />
    </div>
  );
}
