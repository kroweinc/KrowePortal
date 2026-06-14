// Step/scene model for the first-time-builder click-through product tour.
// Pure data + a builder fn — no "use client"; components/tour/tutorial-provider
// consumes this and feeds it to driver.js.
//
// Teaching order matches the platform's core loop: Documents → Clients → Tasks.

export type TourPlacement = "top" | "right" | "bottom" | "left" | "over";

export interface TourStep {
  id: string;
  /** data-tour anchor key (resolved as `[data-tour="<selector>"]`); null
   *  renders a centered modal with no spotlight (welcome / finish). */
  selector: string | null;
  title: string;
  body: string;
  placement?: TourPlacement;
  /** Route to push *before* advancing to the next step (cross-route scenes). */
  navigateOnNext?: string;
}

export interface BuildStepsContext {
  /** Validated, owned project id from profile.onboarding.project_id, or null. */
  projectId: string | null;
  /** Whether the deep-link project-detail steps can run. */
  hasProject: boolean;
}

/**
 * Builds the ordered step list for the current builder. When the builder has no
 * project yet, the project-detail steps (pipeline / PRD / engagement) are
 * dropped and the Documents scene jumps straight to Engagements.
 */
export function buildSteps({ projectId, hasProject }: BuildStepsContext): TourStep[] {
  const steps: TourStep[] = [];

  // ── Welcome ──────────────────────────────────────────────────────────
  steps.push({
    id: "welcome",
    selector: null,
    title: "Welcome to Krowe",
    body: "A 60-second tour of the core loop: prep your documents, bring on a client, then run the work as tasks.",
    navigateOnNext: "/b/projects",
  });

  // ── Documents scene ──────────────────────────────────────────────────
  steps.push({
    id: "nav-documents",
    selector: "nav-documents",
    title: "Start with Documents",
    body: "Every business you pitch starts here. Draft a PRD, quote, and contract before any work begins.",
    placement: "right",
  });

  steps.push({
    id: "new-document",
    selector: "new-document",
    title: "Create a document",
    body: hasProject
      ? "Each prospective business lives in its own document. We'll open one you already have."
      : "Each prospective business lives in its own document — add the prospect's details and any materials whenever you're ready.",
    placement: "left",
    navigateOnNext: hasProject ? `/b/projects/${projectId}` : "/b/engagements",
  });

  if (hasProject) {
    steps.push({
      id: "project-pipeline",
      selector: "project-pipeline",
      title: "Track the deal stages",
      body: "This pipeline shows where the deal stands: PRD, then Quote, then Contract, then a live client.",
      placement: "bottom",
    });
    steps.push({
      id: "project-docs",
      selector: "project-prd",
      title: "Draft the paperwork",
      body: 'Generate a PRD, then a priced quote, then a contract — each from its section’s "+ New" action.',
      placement: "top",
    });
    steps.push({
      id: "begin-engagement",
      selector: "begin-engagement",
      title: "Turn a deal into a build",
      body: "When the contract's signed, start the client here. That's how a document becomes a client you build for.",
      placement: "top",
      navigateOnNext: "/b/engagements",
    });
  }

  // ── Clients scene ────────────────────────────────────────────────────
  steps.push({
    id: "nav-engagements",
    selector: "nav-engagements",
    title: "Your clients live here",
    body: "Each client is one business owner you're building with.",
    placement: "right",
  });

  steps.push({
    id: "new-engagement",
    selector: "new-engagement",
    title: "Bring on a client",
    body: "Create a client to get a secure invite link. Once they accept, you collaborate on the same board.",
    placement: "left",
    navigateOnNext: "/b",
  });

  // ── Tasks scene ──────────────────────────────────────────────────────
  steps.push({
    id: "nav-tasks",
    selector: "nav-tasks",
    title: "Run the work as Tasks",
    body: "The Build Board is home base — everything you're building shows up here.",
    placement: "right",
  });

  steps.push({
    id: "task-board",
    selector: "task-board",
    title: "Track every task",
    body: "Tasks flow across Inbox, In Progress, Approval, and Done. Drag cards as work moves.",
    placement: "top",
  });

  steps.push({
    id: "new-task",
    selector: "new-task",
    title: "Add a task",
    body: "Capture new work here. Your client can add requests too — they land in your Inbox.",
    placement: "left",
  });

  // ── Finish ───────────────────────────────────────────────────────────
  steps.push({
    id: "help-relaunch",
    selector: "help-button",
    title: "Need it again?",
    body: "Replay this tour anytime from the help button up here.",
    placement: "bottom",
  });

  steps.push({
    id: "finish",
    selector: null,
    title: "You're set",
    body: "That's the loop: Documents, Clients, Tasks. Go win your first build.",
  });

  return steps;
}
