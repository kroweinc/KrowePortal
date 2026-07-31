// Shared types for the Agents Control Center — the ⌘K "Ask agent" console that
// reasons over (and acts on) a client's Context Layer. Used by the turn engine
// (runContextAgent), the store, the server actions, and the console UI.

import type { PrdContent, TaskPriority, TaskStatus, TaskType } from "@/lib/types";
import type { DraftPrdInput } from "@/lib/prd/draft-core";

export type AgentRunStatus =
  | "idle"
  | "thinking"
  | "running_tool"
  | "awaiting_input"
  | "done"
  | "error";

/**
 * Where a turn is in its lifecycle, persisted on the run so the parallel-agents
 * dock can fill a progress ring even with no live SSE (after a refresh, or for a
 * run started in another tab). Maps to the engine's own events — never a
 * fabricated timeline: `reading` while grounding retrieval runs, `searching`
 * when a read tool fires, `composing` once the model streams text, `done`/`error`
 * terminal. (`awaiting_input` is carried by `status`, not `phase`.)
 */
export type AgentPhase = "reading" | "searching" | "composing" | "done" | "error";

export type AgentMessageRole = "user" | "assistant" | "tool";

export type AgentToolStatus = "proposed" | "confirmed" | "rejected" | "executed" | "failed";

/** A retrieved context chunk the assistant saw — shown in the Sources disclosure. */
export interface AgentSource {
  title: string;
  kind: string;
  similarity: number;
}

// ── Widgets ─────────────────────────────────────────────────────────────────
// Rendered UI a read tool can attach to an answer, so structured data (real task
// rows with ids/status/priority) reaches the thread as cards instead of being
// flattened to a markdown bullet list. A discriminated union so documents /
// timeline widgets can follow the same seam later.

/** One task row inside a task-board widget. */
export interface AgentWidgetTask {
  id: string;
  title: string;
  priority: TaskPriority;
  type: TaskType | null;
  milestoneTitle?: string | null;
}

/** A read-only, status-grouped task board. Board order is active-first, done-last. */
export interface AgentTasksWidget {
  type: "tasks";
  title?: string;
  groups: { status: TaskStatus; tasks: AgentWidgetTask[] }[];
}

/**
 * A PRD assembling (or assembled) inside a run. `content` is a partial PrdContent
 * while sections stream in and the full document once done; `prdId` is set only
 * after the finished PRD is persisted (the "Open PRD" target). Rendered read-only
 * with the same <PrdDocument> the wizard's live stage uses.
 */
export interface AgentPrdWidget {
  type: "prd";
  prdId?: string;
  projectId: string;
  title: string;
  content: PrdContent;
  sectionsSeen: number;
  sectionsTotal: number;
}

export type AgentWidget = AgentTasksWidget | AgentPrdWidget;

/** One tool call the model emitted (parsed from the OpenAI tool_calls shape). */
export interface AgentToolCall {
  id: string; // OpenAI tool_call_id
  name: string; // function name, e.g. "create_task"
  arguments: Record<string, unknown>; // parsed function arguments
}

export interface AgentRun {
  id: string;
  /** 'chat' — a grounded conversation over an engagement; 'prd' — a durable PRD
      generation run over a project. */
  kind: "chat" | "prd";
  /** Null for a PRD run (a PRD is project-scoped and often has no engagement). */
  engagementId: string | null;
  /** Set for a PRD run — the project the PRD belongs to. */
  projectId?: string | null;
  /** Set once a PRD run finishes and its document is persisted. */
  prdId?: string | null;
  builderId: string;
  /** The DraftPrdInput a PRD run generates from — server-only; unused client-side. */
  prdInput?: DraftPrdInput | null;
  /** The page context the chat run was last fired from — a human page label
      ("the Tasks board") and the specific document then in view. Sticky across
      turns so a follow-up keeps the chat's page context even when sent from the
      neutral agent workspace (`/b/agent/[runId]`), where the client can't
      re-derive it. Mirrors projectId. */
  page?: string | null;
  viewedDoc?: { kind: "prd" | "quote" | "contract"; id: string } | null;
  title: string;
  status: AgentRunStatus;
  phase?: AgentPhase | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One in-flight (or just-finished) run as the parallel-agents dock knows it —
 * enough to paint a ring and route to the conversation, resolved in one query by
 * getActiveRuns(). `clientName` is joined here so the dock never re-reads it.
 */
export interface ActiveRun {
  id: string;
  kind: "chat" | "prd";
  title: string;
  clientName: string;
  engagementId: string | null;
  /** PRD runs carry the project + (once finished) the PRD id so the dock can link
      straight to the document without another read. */
  projectId?: string | null;
  prdId?: string | null;
  status: AgentRunStatus;
  phase: AgentPhase | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Shallow counts behind the hub's context chips — what the agent can reason over
 * for one client. Deliberately head-counts (see summarizeContext) rather than
 * assembling the real context, which is far too heavy for an idle palette.
 */
export interface EngagementContextSummary {
  documents: number;
  tasks: number;
  repoConnected: boolean;
}

/**
 * A client as the hub knows it: the switcher lists these and the Context row
 * names one. Deliberately not the full Engagement — the hub reads a name and an
 * id, and the joined project that Engagement carries drags a context blob across
 * the wire that nothing here paints.
 */
export interface AgentHubEngagement {
  id: string;
  title: string;
  /** The outbound project this client was started from (0039), if any — the
      target for the "Draft a PRD" launcher. */
  projectId: string | null;
}

/**
 * Everything the hub's idle state needs to paint, resolved in one round trip
 * (see getAgentHubData). The console used to fetch the clients, then — once the
 * scoped client had resolved — its runs and counts, so the Context row sat empty
 * across two sequential browser→server hops. It's since gone one better: the
 * toolbar warms this payload on mount (lib/agent/hub-cache.ts), so the hop is
 * usually paid before the palette opens rather than during.
 */
export interface AgentHubData {
  engagements: AgentHubEngagement[];
  /** The client the hub opens on: the URL's, if it's one of ours; else the newest. */
  engagementId: string | null;
  runs: AgentRun[];
  /** null when there's no client in scope, or the counts couldn't be read. */
  summary: EngagementContextSummary | null;
}

export interface AgentMessage {
  id: string;
  runId: string;
  role: AgentMessageRole;
  content: string;
  toolCalls?: AgentToolCall[] | null;
  toolCallId?: string | null;
  toolStatus?: AgentToolStatus | null;
  sources?: AgentSource[] | null;
  widgets?: AgentWidget[] | null;
  createdAt: string;
}

/**
 * Events the turn engine yields, forwarded to the browser as SSE frames. Kept
 * flat + JSON-serializable so the route can `data: ${JSON.stringify(event)}`.
 */
export type AgentEvent =
  | { type: "status"; status: AgentRunStatus; label?: string }
  // Durable phase transition (reading→searching→composing→done). Persisted by
  // the route for the dock; also forwarded so a connected client animates its
  // ring in real time instead of waiting on the next poll.
  | { type: "phase"; phase: AgentPhase }
  | { type: "sources"; sources: AgentSource[] }
  | { type: "delta"; text: string }
  | { type: "tool"; phase: "start" | "done"; name: string } // read tool auto-run
  // A read tool attached rendered UI. Yielded as it arrives so the board paints
  // before the model finishes composing the prose lead.
  | { type: "widget"; widget: AgentWidget }
  // Terminal events carry everything the route needs to persist the assistant
  // turn. `messageId` is filled in by the route after persistence (the engine
  // leaves it unset) so the client can wire follow-up actions to the row.
  | { type: "proposal"; content: string; toolCalls: AgentToolCall[]; sources: AgentSource[]; widgets?: AgentWidget[]; messageId?: string } // write tools awaiting confirmation
  | { type: "final"; content: string; sources: AgentSource[]; widgets?: AgentWidget[]; messageId?: string } // terminal text answer
  | { type: "error"; error: string };

/**
 * SSE frames a durable PRD generation run emits (app/api/ai/prd/run). Distinct
 * from AgentEvent — a PRD run streams at section granularity (not tokens): each
 * closed top-level section fires `section` (drives the ring) and `content` (the
 * validated PRD-so-far, for the live widget). `done` carries the finished widget +
 * persisted prdId. Flat + JSON-serializable, same as AgentEvent.
 */
export type PrdRunEvent =
  | { type: "phase"; phase: AgentPhase }
  | { type: "section"; key: string; sectionsSeen: number }
  | { type: "content"; partial: PrdContent }
  | { type: "done"; prdId: string; widget: AgentPrdWidget; messageId?: string }
  | { type: "error"; error: string };
