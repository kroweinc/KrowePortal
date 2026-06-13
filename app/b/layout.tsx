import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { Nav } from "@/components/nav";
import { Sidebar } from "@/components/sidebar";
import { DoneDeliverableProvider } from "@/components/done-deliverable-provider";
import { ApprovalDeliverableProvider } from "@/components/approval-deliverable-provider";

const BUILDER_TABS = [
  { label: "Tasks", href: "/b", icon: "list-checks" },
  { label: "Engagements", href: "/b/engagements", icon: "briefcase" },
  { label: "Repo", href: "/b/github", icon: "git-branch" },
  { label: "Documents", href: "/b/projects", icon: "file-text" },
  { label: "Profile", href: "/b/profile", icon: "user-round" },
  { label: "Settings", href: "/b/settings", icon: "settings" },
];

export default async function BuilderLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  // Single enforcement point for the builder route tree — operators are sent
  // to their own portal rather than relying on each page to self-guard.
  if (profile.role !== "builder") redirect("/o");

  return (
    <div className="krowe-app">
      <Sidebar tabs={BUILDER_TABS} basePath="/b" />
      <div className="krowe-main">
        <Nav profile={profile} />
        <DoneDeliverableProvider>
          <ApprovalDeliverableProvider>{children}</ApprovalDeliverableProvider>
        </DoneDeliverableProvider>
      </div>
    </div>
  );
}
