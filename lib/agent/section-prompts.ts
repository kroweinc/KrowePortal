import type { BuilderSection } from "@/lib/nav-commands";

// Per-section copy for the agent surfaces. The toolbar omnibox
// (components/global-search.tsx) and the hub (components/agent/agent-console.tsx)
// both pull from here so their page-aware suggestions can't drift apart — the
// same reason lib/nav-commands.ts is shared. `agent`/`general` fall back to the
// neutral, cross-page set that mirrors the CAPABILITIES grid's default order.
//
// Phrases interpolate the client in view; they're written to read naturally
// whether `clientName` is a real name or the omnibox's generic "a client".

/**
 * The rotating "Krowe can…" phrases overlaid on the empty input, leaning toward
 * what the builder most likely wants on the page in view.
 */
export function krowecanFor(section: BuilderSection, clientName: string): string[] {
  switch (section) {
    case "tasks":
      return [
        `Krowe can create a task for ${clientName}`,
        "Krowe can move a task on the board",
        "Krowe can sort your tasks",
        "Krowe can send a task for approval",
      ];
    case "documents":
      return [
        `Krowe can draft a PRD for ${clientName}`,
        "Krowe can edit a document",
        "Krowe can refine a PRD section",
        `Krowe can reason over ${clientName}'s docs`,
      ];
    case "clients":
      return [
        `Krowe can summarize ${clientName}`,
        `Krowe can tell you where ${clientName} stands`,
        `Krowe can reason over ${clientName}'s context`,
        `Krowe can create a task for ${clientName}`,
      ];
    case "repo":
      return [
        "Krowe can summarize the codebase",
        "Krowe can tie a task to a branch",
        `Krowe can reason over ${clientName}'s repo`,
        "Krowe can move a task on the board",
      ];
    default:
      return [
        `Krowe can summarize ${clientName}`,
        `Krowe can create a task for ${clientName}`,
        "Krowe can move a task on the board",
        "Krowe can sort your tasks",
        "Krowe can send a task for approval",
        `Krowe can reason over ${clientName}'s context`,
      ];
  }
}

/**
 * The "Try asking" rows — full questions the builder can fire verbatim, aimed at
 * the current page.
 */
export function suggestionsFor(section: BuilderSection, clientName: string): string[] {
  switch (section) {
    case "tasks":
      return [
        `What's left on ${clientName}'s build board?`,
        "What's blocking the current milestone?",
        "Sort my tasks by priority",
      ];
    case "documents":
      return [
        `What documents are outstanding for ${clientName}?`,
        "Add a goal to the PRD",
        "Refine the Features section of the PRD",
      ];
    case "repo":
      return [
        `What's in ${clientName}'s repo?`,
        "Summarize the recent commits",
        "Which branches are still open?",
      ];
    default:
      return [
        `Where does ${clientName} stand this week?`,
        "What's blocking the current milestone?",
        "Summarize what's left on the build board",
      ];
  }
}

/**
 * The caret-free, non-animated hint shown under prefers-reduced-motion — a stable
 * label naming the same page lean the typewriter would otherwise rotate through.
 */
export function reducedHint(section: BuilderSection, clientName: string): string {
  switch (section) {
    case "tasks":
      return `Ask Krowe about ${clientName}'s tasks…`;
    case "documents":
      return `Ask Krowe about ${clientName}'s documents…`;
    case "repo":
      return `Ask Krowe about ${clientName}'s repo…`;
    default:
      return `Ask Krowe anything about ${clientName}…`;
  }
}
