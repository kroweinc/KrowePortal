"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { advanceOnboarding, finishOnboarding } from "@/lib/actions/onboarding";
import {
  PathStep,
  ProspectStep,
  HandoffStep,
  ClientStep,
  RepoStep,
  TasksStep,
  DocsStep,
} from "./steps";
import type { WizardNav } from "./wizard-shell";
import type { GitHubRepo, OnboardingPath, OnboardingStep } from "@/lib/types";

export interface WizardProps {
  step: OnboardingStep;
  path?: OnboardingPath;
  oauthError?: string;
  project: { id: string; name: string } | null;
  engagement: { id: string; title: string; repoFullName: string | null } | null;
  inviteToken: string | null;
  github: { connected: boolean; repos: GitHubRepo[] };
}

const STEPS_BY_PATH: Record<OnboardingPath, OnboardingStep[]> = {
  no_clients: ["path", "prospect", "handoff"],
  has_clients: ["path", "client", "repo", "tasks", "docs"],
};

// Deterministic Back: the previous step is derived from STEPS_BY_PATH so forward
// and backward navigation can never desync. State lives in the DB, not a history
// stack, so this survives router.refresh() and resume.
function prevStep(step: OnboardingStep, path?: OnboardingPath): OnboardingStep | null {
  if (!path) return null;
  const seq = STEPS_BY_PATH[path];
  const i = seq.indexOf(step);
  return i > 0 ? seq[i - 1] : null;
}

export function OnboardingWizard({
  step,
  path,
  oauthError,
  project,
  engagement,
  inviteToken,
  github,
}: WizardProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const prev = prevStep(step, path);

  const nav: WizardNav = {
    canBack: prev !== null && step !== "path",
    back: () =>
      startTransition(async () => {
        if (prev) await advanceOnboarding(prev, path);
        router.refresh();
      }),
    exit: () =>
      startTransition(async () => {
        await finishOnboarding("dismissed");
        router.push("/b");
      }),
  };

  const clientName = engagement?.title;

  switch (step) {
    case "path":
      return <PathStep key="path" nav={nav} />;
    case "prospect":
      return <ProspectStep key="prospect" nav={nav} />;
    case "handoff":
      return project ? <HandoffStep key="handoff" nav={nav} project={project} /> : null;
    case "client":
      return (
        <ClientStep
          key="client"
          nav={nav}
          existing={engagement ? { title: engagement.title, inviteToken } : null}
        />
      );
    case "repo":
      return (
        <RepoStep
          key="repo"
          nav={nav}
          connected={github.connected}
          repos={github.repos}
          engagement={engagement ? { id: engagement.id, repoFullName: engagement.repoFullName } : null}
          clientName={clientName}
          oauthError={oauthError}
        />
      );
    case "tasks":
      return <TasksStep key="tasks" nav={nav} engagementId={engagement?.id ?? null} clientName={clientName} />;
    case "docs":
      return (
        <DocsStep
          key="docs"
          nav={nav}
          projectId={project?.id ?? null}
          engagementId={engagement?.id ?? null}
          clientName={clientName}
        />
      );
    default:
      return null;
  }
}
