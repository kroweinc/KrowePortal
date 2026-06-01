import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { Nav } from "@/components/nav";
import { Sidebar } from "@/components/sidebar";
import { DoneDeliverableProvider } from "@/components/done-deliverable-provider";

const BUILDER_TABS = [
  { label: "Tasks", href: "/b" },
  { label: "Repo", href: "/b/github" },
  { label: "Projects", href: "/b/projects" },
  { label: "Engagement", href: "/b/engagement" },
];

export default async function BuilderLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  return (
    <div className="krowe-app">
      <Sidebar tabs={BUILDER_TABS} basePath="/b" />
      <div className="krowe-main">
        <Nav profile={profile} />
        <DoneDeliverableProvider>{children}</DoneDeliverableProvider>
      </div>
    </div>
  );
}
