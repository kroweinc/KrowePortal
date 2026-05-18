import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { Nav } from "@/components/nav";
import { BuilderTabs } from "@/components/builder-tabs";
import { DoneDeliverableProvider } from "@/components/done-deliverable-provider";

export default async function BuilderLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  return (
    <div className="krowe-app">
      <Nav profile={profile} />
      <BuilderTabs />
      <DoneDeliverableProvider>
        {children}
      </DoneDeliverableProvider>
    </div>
  );
}
