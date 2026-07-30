import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { OnboardingForm } from "./onboarding-form";
import { OnboardingWizard, type OnboardingBuilderProfile, type WizardProps } from "./wizard";
import { EditorialShell } from "./wizard-shell";
import { PortalTeaserStage } from "./wizard-stages";
import { ONBOARDING_STEPS } from "@/lib/types";
import type { AgencySize, AgencyType, OnboardingStep, PricingModel } from "@/lib/types";

// The wizard's current step lives in profiles.onboarding.step — this page just
// renders whatever the DB says, so refresh, re-login, and OAuth round-trips all
// resume at the right step.
export const metadata = { title: "Welcome" };

const AVATAR_SIGNED_URL_TTL = 60 * 60 * 24; // outlives any cached render

export default async function OnboardingPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/login");

    const fullName =
      (user.user_metadata?.full_name as string | undefined) ??
      (user.user_metadata?.name as string | undefined) ??
      "";

    return (
      <EditorialShell
        title="Welcome to Krowe Portal"
        sub="Tell us who you are to get started."
        note="This is how clients and teammates will see you across the portal."
        stageEyebrow="Welcome to Krowe"
        stageHeadline="Everything for your clients, in one calm place."
        stageSub="Pitches, clients, code, and the shared board — they all live here."
        stage={<PortalTeaserStage />}
      >
        <OnboardingForm defaultName={fullName} />
      </EditorialShell>
    );
  }

  if (profile.role === "operator") redirect("/o");
  if (profile.onboarding_status !== "in_progress") redirect("/b");

  // ?? {} — tolerates a DB that hasn't run migration 0053 yet.
  const ob = profile.onboarding ?? {};
  // A step the wizard no longer knows about — a builder stranded mid-flow when
  // the steps changed — restarts at identity instead of rendering nothing. The
  // wizard's switch has no case for it, and the page they'd get back has no Back
  // or Skip to escape with, so an unrecognized value can't be trusted here.
  const step: OnboardingStep = ONBOARDING_STEPS.includes(ob.step as OnboardingStep)
    ? (ob.step as OnboardingStep)
    : "identity";
  const admin = createAdminClient();

  // The builder's answers so far, so every step renders prefilled and resume-safe.
  const { data: bp } = await admin
    .from("builder_profiles")
    .select("agency_name, agency_role, agency_website, agency_type, agency_size, pricing_model, default_hourly_rate, avatar_storage_path")
    .eq("user_id", profile.id)
    .maybeSingle();

  let avatarUrl: string | null = null;
  if (bp?.avatar_storage_path) {
    const { data: signed } = await admin.storage
      .from("avatars")
      .createSignedUrl(bp.avatar_storage_path as string, AVATAR_SIGNED_URL_TTL);
    avatarUrl = signed?.signedUrl ?? null;
  }

  const builderProfile: OnboardingBuilderProfile = {
    displayName: profile.display_name ?? "",
    agencyName: (bp?.agency_name as string | null) ?? null,
    agencyRole: (bp?.agency_role as string | null) ?? null,
    agencyWebsite: (bp?.agency_website as string | null) ?? null,
    agencyType: (bp?.agency_type as AgencyType | null) ?? null,
    agencySize: (bp?.agency_size as AgencySize | null) ?? null,
    pricingModel: (bp?.pricing_model as PricingModel | null) ?? null,
    hourlyRate: (bp?.default_hourly_rate as number | null) ?? null,
    avatarUrl,
  };

  // The optional client step: an engagement + invite from a prior wizard attempt.
  let engagement: WizardProps["engagement"] = null;
  let inviteToken: string | null = null;
  if (ob.engagement_id) {
    const { data } = await admin
      .from("engagements")
      .select("id, title, operator_id")
      .eq("id", ob.engagement_id)
      .eq("builder_id", profile.id)
      .maybeSingle();
    if (data) {
      engagement = { id: data.id as string, title: data.title as string };
      if (step === "client" && !data.operator_id) {
        const { data: invite } = await admin
          .from("invitations")
          .select("token")
          .eq("engagement_id", data.id)
          .eq("status", "pending")
          .gt("expires_at", new Date().toISOString())
          .maybeSingle();
        inviteToken = (invite?.token as string | undefined) ?? null;
      }
    }
  }

  return (
    <OnboardingWizard
      step={step}
      engagement={engagement}
      inviteToken={inviteToken}
      profile={builderProfile}
    />
  );
}
