"use client";

import * as React from "react";
import { RotateCw } from "lucide-react";

import { getAgentRun } from "@/lib/actions/agent";
import {
  useAgentRun,
  useAgentRunsApi,
  type QueueItem,
} from "@/components/agent/agent-runs-provider";
import { AgentPrdWidget } from "@/components/agent/prd-widget";
import type { AgentPrdWidget as AgentPrdWidgetPayload } from "@/lib/agent/types";
import type { PrdContent } from "@/lib/types";

// The dock popover's view for a PRD generation run — a PRD run has no chat input,
// so it renders the document (live-assembling or finished) rather than <AgentThread>.
// Live sections come from the provider's LiveRun; a run reopened after a refresh
// (no live stream) loads its persisted assistant-message widget. An errored run
// offers Retry, which re-drives the run from its stored DraftPrdInput.
export function PrdRunPanel({ focus }: { focus: QueueItem }) {
  const live = useAgentRun(focus.runId);
  const { startRun } = useAgentRunsApi();
  const [persisted, setPersisted] = React.useState<AgentPrdWidgetPayload | null>(null);

  const status = live?.status ?? focus.status;
  const err = live?.error ?? focus.error;

  // Build a widget from live streamed state when we have any content (or a finished id).
  const liveWidget: AgentPrdWidgetPayload | null =
    live && (live.prdPartial || live.prdId)
      ? {
          type: "prd",
          prdId: live.prdId ?? focus.prdId ?? undefined,
          projectId: focus.projectId ?? "",
          title: focus.title,
          content: (live.prdPartial ?? {}) as PrdContent,
          sectionsSeen: live.prdSectionsSeen,
          sectionsTotal: live.prdSectionsTotal,
        }
      : null;

  const hasLive = !!liveWidget;
  const streaming = live?.streaming ?? false;

  // No live content (hydrated from the poll, or reopened after a refresh) → load the
  // persisted PRD widget off the run's assistant message. Skip while a live stream is
  // in flight (its content is the fresher source).
  React.useEffect(() => {
    if (hasLive || streaming) return;
    let alive = true;
    getAgentRun(focus.runId)
      .then((res) => {
        if (!alive || "error" in res) return;
        for (const m of res.messages) {
          const w = m.widgets?.find((x) => x.type === "prd");
          if (w) {
            setPersisted(w as AgentPrdWidgetPayload);
            return;
          }
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [focus.runId, streaming, hasLive]);

  const widget = liveWidget ?? persisted;

  return (
    <div className="krowe-aq-prd-panel">
      {status === "error" ? (
        <div className="krowe-aq-prd-err">
          <p>{err ?? "Generation didn't finish."}</p>
          <button
            type="button"
            className="krowe-aq-prd-retry"
            onClick={() =>
              startRun({
                runId: focus.runId,
                kind: "prd",
                engagementId: focus.engagementId,
                projectId: focus.projectId,
                clientName: focus.clientName,
                title: focus.title,
              })
            }
          >
            <RotateCw size={14} aria-hidden="true" />
            Try again
          </button>
        </div>
      ) : widget ? (
        <AgentPrdWidget widget={widget} />
      ) : (
        <p className="krowe-aq-prd-empty">
          {status === "done"
            ? "Opening your PRD…"
            : `Drafting your PRD · ${focus.prdSectionsSeen}/${focus.prdSectionsTotal}`}
        </p>
      )}
    </div>
  );
}
