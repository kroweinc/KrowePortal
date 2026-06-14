import { redirect } from "next/navigation";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { Nav } from "@/components/nav";
import { Sidebar } from "@/components/sidebar";
import { DoneDeliverableProvider } from "@/components/done-deliverable-provider";
import { ApprovalDeliverableProvider } from "@/components/approval-deliverable-provider";
import { TutorialProvider } from "@/components/tour/tutorial-provider";

const BUILDER_TABS = [
  { label: "Tasks", href: "/b", icon: "list-checks", tour: "nav-tasks" },
  { label: "Clients", href: "/b/engagements", icon: "briefcase", tour: "nav-engagements" },
  { label: "Repo", href: "/b/github", icon: "git-branch" },
  { label: "Documents", href: "/b/projects", icon: "file-text", tour: "nav-documents" },
  { label: "Profile", href: "/b/profile", icon: "user-round" },
  { label: "Settings", href: "/b/settings", icon: "settings" },
];

export default async function BuilderLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  // Single enforcement point for the builder route tree — operators are sent
  // to their own portal rather than relying on each page to self-guard.
  if (profile.role !== "builder") redirect("/o");

  // Product tour: auto-start once for builders who haven't seen it, unless the
  // onboarding form wizard is still mid-flow (so the two never collide). The
  // deep-link Documents steps need a real project — validate the one onboarding
  // stashed (if any) so a stale id never strands the tour on a 404. Most
  // builders carry an empty onboarding jsonb, so this query is skipped.
  const autoStartTour =
    profile.tour_status === "pending" && profile.onboarding_status !== "in_progress";

  let tourProjectId: string | null = null;
  const stashedProjectId = profile.onboarding?.project_id;
  if (stashedProjectId) {
    const supabase = DEV_PROFILE_IDS.has(profile.id)
      ? createAdminClient()
      : await createClient();
    const { data } = await supabase
      .from("projects")
      .select("id")
      .eq("id", stashedProjectId)
      .eq("owner_id", profile.id)
      .maybeSingle();
    tourProjectId = data ? (data.id as string) : null;
  }

  return (
    <div className="krowe-app">
      <Sidebar tabs={BUILDER_TABS} basePath="/b" />
      <div className="krowe-main">
        <Nav profile={profile} />
        <DoneDeliverableProvider>
          <ApprovalDeliverableProvider>
            <TutorialProvider
              autoStart={autoStartTour}
              projectId={tourProjectId}
              hasProject={Boolean(tourProjectId)}
            >
              {children}
            </TutorialProvider>
          </ApprovalDeliverableProvider>
        </DoneDeliverableProvider>
      </div>
    </div>
  );
}
