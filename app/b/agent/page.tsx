import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { getMyEngagements } from "@/lib/actions/invitations";
import { getProjects } from "@/lib/actions/projects";
import { listAllAgentRuns } from "@/lib/actions/agent";
import { AgentHub } from "@/components/agent/agent-hub";

export const metadata = { title: "Agents" };

// The Agents Hub — the cross-client home the dock's "View all" lands on. A launchpad
// of the catalog's named agents (each riding the existing chat/prd run engines) plus
// a cross-client activity feed of every run (active + history). Scope is chosen per
// launch, so the page itself never pins one client. The server only gates access and
// hands the client the launch options + the first page of run history; the feed
// reconciles that with the live run store client-side.

export default async function AgentHubPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") redirect("/o");

  const [engagementsRaw, projectsRaw, initialHistory] = await Promise.all([
    getMyEngagements(),
    getProjects(),
    listAllAgentRuns(),
  ]);

  // Resolve each client's display name the same way the feed does (activeClientName):
  // prospect name → project name → engagement title.
  const engagements = engagementsRaw.map((e) => ({
    id: e.id,
    name: e.project?.prospect_name ?? e.project?.name ?? e.title ?? "Client",
  }));
  const projects = projectsRaw.map((p) => ({ id: p.id, name: p.name }));

  return (
    <main className="krowe-page">
      <div className="krowe-page-inner">
        <AgentHub engagements={engagements} projects={projects} initialHistory={initialHistory} />
      </div>
    </main>
  );
}
