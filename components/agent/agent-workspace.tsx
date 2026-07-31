"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Briefcase } from "lucide-react";

import { AgentThread, toUIMessages } from "@/components/agent/agent-thread";
import type { AgentMessage, AgentRun } from "@/lib/agent/types";

// Thin client seam for the full-page agent workspace. The server route has
// already authorized and loaded the run, so this only maps the persisted rows
// into thread bubbles — no client round-trip before the thread paints.

export function AgentWorkspace({
  run,
  messages,
  clientName,
}: {
  run: AgentRun;
  messages: AgentMessage[];
  clientName: string;
}) {
  const initialMessages = React.useMemo(() => toUIMessages(messages), [messages]);

  return (
    <div className="krowe-ah krowe-ah-page">
      <div className="krowe-ah-head">
        <Link href="/b/engagements" className="krowe-agent-back" aria-label="Back to clients">
          <ArrowLeft size={16} />
        </Link>
        <span className="krowe-ah-head-client">
          <Briefcase size={13} />
          {clientName}
        </span>
        <span className="krowe-ah-head-title">{run.title}</span>
      </div>

      <AgentThread
        engagementId={run.engagementId ?? ""}
        clientName={clientName}
        initialRunId={run.id}
        initialMessages={initialMessages}
        variant="page"
        autoFocus={false}
      />
    </div>
  );
}
