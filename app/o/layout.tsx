import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { Nav } from "@/components/nav";
import { Sidebar } from "@/components/sidebar";
import { DoneDeliverableProvider } from "@/components/done-deliverable-provider";
import { ApprovalDeliverableProvider } from "@/components/approval-deliverable-provider";

const OPERATOR_TABS = [
  { label: "Tasks", href: "/o", icon: "list-checks" },
  { label: "Engagement", href: "/o/engagement", icon: "briefcase" },
  { label: "Project", href: "/o/project", icon: "folder-kanban" },
];

export default async function OperatorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  // Single enforcement point for the operator route tree.
  if (profile.role !== "operator") redirect("/b");

  return (
    <div className="krowe-app">
      <Sidebar tabs={OPERATOR_TABS} basePath="/o" />
      <div className="krowe-main">
        <Nav profile={profile} />
        <DoneDeliverableProvider>
          <ApprovalDeliverableProvider>{children}</ApprovalDeliverableProvider>
        </DoneDeliverableProvider>
      </div>
    </div>
  );
}
