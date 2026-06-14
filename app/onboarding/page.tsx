import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getUserGithubConnection } from "@/lib/github/token";
import { fetchGithubRepos } from "@/lib/github/list-repos";
import { OnboardingForm } from "./onboarding-form";
import { OnboardingWizard, type WizardProps } from "./wizard";
import { EditorialShell } from "./wizard-shell";
import { PortalTeaserStage } from "./wizard-stages";
import type { OnboardingStep } from "@/lib/types";

// The wizard's current step lives in profiles.onboarding.step — this page just
// renders whatever the DB says, so refresh, re-login, and the GitHub OAuth
// round-trip all resume at the right step.
export const metadata = { title: "Welcome" };

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const profile = await getCurrentProfile();
  const { error: oauthError } = await searchParams;

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
  let step: OnboardingStep = ob.step ?? "path";
  const admin = createAdminClient();

  // Per-step data, always scoped to this builder.
  let project: WizardProps["project"] = null;
  if (ob.project_id) {
    const { data } = await admin
      .from("projects")
      .select("id, name")
      .eq("id", ob.project_id)
      .eq("owner_id", profile.id)
      .maybeSingle();
    project = (data ?? null) as WizardProps["project"];
  }

  let engagement: WizardProps["engagement"] = null;
  let inviteToken: string | null = null;
  if (ob.engagement_id) {
    const { data } = await admin
      .from("engagements")
      .select("id, title, operator_id, github_repo_full_name")
      .eq("id", ob.engagement_id)
      .eq("builder_id", profile.id)
      .maybeSingle();
    if (data) {
      engagement = {
        id: data.id as string,
        title: data.title as string,
        repoFullName: (data.github_repo_full_name as string | null) ?? null,
      };
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

  // If the entity a step depends on disappeared (deleted mid-wizard), fall
  // back to the step that recreates it.
  if (step === "handoff" && !project) step = "prospect";
  if ((step === "repo" || step === "tasks" || step === "docs") && !engagement) step = "client";

  let github: WizardProps["github"] = { connected: false, repos: [] };
  if (step === "repo") {
    const connection = await getUserGithubConnection(profile.id);
    github = {
      connected: !!connection,
      repos: connection ? await fetchGithubRepos(connection.token) : [],
    };
  }

  return (
    <OnboardingWizard
      step={step}
      path={ob.path}
      oauthError={oauthError}
      project={project}
      engagement={engagement}
      inviteToken={inviteToken}
      github={github}
    />
  );
}
