"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { advanceOnboarding, finishOnboarding } from "@/lib/actions/onboarding";
import {
  IdentityStep,
  AgencyTypeStep,
  AgencySizeStep,
  ClientStep,
  ChargingStep,
} from "./steps";
import type { WizardNav } from "./wizard-shell";
import { ONBOARDING_STEPS } from "@/lib/types";
import type {
  AgencySize,
  AgencyType,
  OnboardingStep,
  PricingModel,
} from "@/lib/types";

// The builder's onboarding answers so far, loaded server-side and threaded in so
// each step renders prefilled (resume-safe — the wizard holds no local history).
export interface OnboardingBuilderProfile {
  displayName: string;
  agencyName: string | null;
  agencyRole: string | null;
  agencyWebsite: string | null;
  agencyType: AgencyType | null;
  agencySize: AgencySize | null;
  pricingModel: PricingModel | null;
  hourlyRate: number | null;
  avatarUrl: string | null;
}

export interface WizardProps {
  step: OnboardingStep;
  engagement: { id: string; title: string } | null;
  inviteToken: string | null;
  profile: OnboardingBuilderProfile;
}

// Single linear flow — no fork. Back is derived from ONBOARDING_STEPS' order so
// forward and backward navigation can never desync; state lives in the DB, not a
// history stack, so this survives router.refresh() and resume.
function prevStep(step: OnboardingStep): OnboardingStep | null {
  const i = ONBOARDING_STEPS.indexOf(step);
  return i > 0 ? ONBOARDING_STEPS[i - 1] : null;
}

export function OnboardingWizard({ step, engagement, inviteToken, profile }: WizardProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const prev = prevStep(step);

  const nav: WizardNav = {
    canBack: prev !== null,
    back: () =>
      startTransition(async () => {
        if (prev) await advanceOnboarding(prev);
        router.refresh();
      }),
    exit: () =>
      startTransition(async () => {
        await finishOnboarding("dismissed");
        router.push("/b");
      }),
  };

  switch (step) {
    case "identity":
      return <IdentityStep key="identity" nav={nav} profile={profile} />;
    case "agency_type":
      return <AgencyTypeStep key="agency_type" nav={nav} selected={profile.agencyType} />;
    case "agency_size":
      return (
        <AgencySizeStep
          key="agency_size"
          nav={nav}
          selected={profile.agencySize}
          priorType={profile.agencyType}
        />
      );
    case "client":
      return (
        <ClientStep
          key="client"
          nav={nav}
          existing={engagement ? { title: engagement.title, inviteToken } : null}
        />
      );
    case "charging":
      return (
        <ChargingStep
          key="charging"
          nav={nav}
          selectedModel={profile.pricingModel}
          hourlyRate={profile.hourlyRate}
        />
      );
    default:
      return null;
  }
}
