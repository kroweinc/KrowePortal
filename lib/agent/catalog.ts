import { Briefcase, FileText, ListChecks, MessageSquare, type LucideIcon } from "lucide-react";

// The declarative registry behind the Agents Hub launchpad. Each entry is a
// distinct *named agent* — but they ride the two EXISTING run engines (chat + prd),
// so a new agent is one array entry, never a new engine/route/store/migration. A
// chat agent is just a different opening move (`seed`) + page-lean into the same
// grounded loop + tools; the PRD agent hands off to the existing durable PRD run.
//
// This is client-safe (lucide only) and imported directly by the client launchpad,
// so the LucideIcon refs never have to cross the server→client seam as props.
//
// Note: this is intentionally distinct from CAPABILITIES (agent-console.tsx), which
// answers "what, inside the Context Chat agent" (per-client tool shortcuts for the
// ⌘K palette). The catalog answers "which agent" on the hub. `seed`/`page` mirror
// Capability.prompt/the page-lean so the two share one mental model.

export type AgentEngine = "chat" | "prd";
export type AgentScopeKind = "client" | "project";

export interface AgentDescriptor {
  /** Stable slug — also the feed's per-agent filter key. */
  id: string;
  name: string;
  blurb: string;
  /** One-word-ish footer note on the launch card — what the agent touches
      ("Uses full context", "Runs in background", "Acts on the board", "Read-only"). */
  tag: string;
  icon: LucideIcon;
  /** Which existing engine backs it — NOT a new engine. */
  engine: AgentEngine;
  /** "client" → needs an engagementId; "project" → needs a projectId. */
  scopeKind: AgentScopeKind;
  /** chat agents only. The first user message, seeded from the chosen client's
      name. Undefined → open an empty grounded Context Chat (the generalist). */
  seed?: (clientName: string) => string;
  /** chat agents only. Page-lean forwarded to startRun({ page }) so the turn biases
      the same way the section surfaces already do. */
  page?: string;
  /** Shipped but not yet on the launchpad grid (plumbing-first rollout). */
  hidden?: boolean;
}

export const AGENT_CATALOG: AgentDescriptor[] = [
  {
    id: "context-chat",
    name: "Context Chat",
    blurb: "Reason over and act on a client's whole Context Layer.",
    tag: "Uses full context",
    icon: MessageSquare,
    engine: "chat",
    scopeKind: "client",
    // no seed → opens an empty grounded conversation (the generalist).
  },
  {
    id: "prd-writer",
    name: "PRD Writer",
    blurb: "Generate a full PRD for a project in the background.",
    tag: "Runs in background",
    icon: FileText,
    engine: "prd",
    scopeKind: "project",
  },
  {
    id: "task-manager",
    name: "Task Manager",
    blurb: "Create, move, sort, and send tasks on the build board.",
    tag: "Acts on the board",
    icon: ListChecks,
    engine: "chat",
    scopeKind: "client",
    seed: (c) => `Help me manage ${c}'s build board — what needs attention?`,
    page: "the Tasks board",
  },
  {
    id: "client-summary",
    name: "Client Summary",
    blurb: "A standing brief on where a client stands right now.",
    tag: "Read-only",
    icon: Briefcase,
    engine: "chat",
    scopeKind: "client",
    seed: (c) => `Summarize where ${c} stands right now.`,
  },
];

export function catalogAgent(id: string): AgentDescriptor | undefined {
  return AGENT_CATALOG.find((a) => a.id === id);
}

/** The agents shown on the launchpad grid (drops any `hidden` plumbing-first ones). */
export function launchpadAgents(): AgentDescriptor[] {
  return AGENT_CATALOG.filter((a) => !a.hidden);
}
