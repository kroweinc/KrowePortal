import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { Nav } from "@/components/nav";
import { Sidebar } from "@/components/sidebar";
import { DoneDeliverableProvider } from "@/components/done-deliverable-provider";

const OPERATOR_TABS = [
  { label: "Tasks", href: "/o" },
  { label: "Project", href: "/o/project" },
];

export default async function OperatorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  return (
    <div className="krowe-app">
      <Sidebar tabs={OPERATOR_TABS} basePath="/o" />
      <div className="krowe-main">
        <Nav profile={profile} />
        <DoneDeliverableProvider>{children}</DoneDeliverableProvider>
      </div>
    </div>
  );
}
