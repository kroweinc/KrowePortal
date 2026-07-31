import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { getAgentRun } from "@/lib/actions/agent";
import { getMyEngagements } from "@/lib/actions/invitations";
import { AgentWorkspace } from "@/components/agent/agent-workspace";

export const metadata = { title: "Agent" };

// The full-page home of one agent conversation — where the ⌘K palette hands off
// when a thread outgrows it. getAgentRun authorizes ownership of the run's
// engagement, so a non-owner (or a bad id) lands on notFound rather than a
// leaked title.

export default async function AgentRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") redirect("/o");

  const { runId } = await params;
  const res = await getAgentRun(runId);
  if ("error" in res) notFound();

  // A PRD run has no chat workspace — its home is the document (or the project
  // while it's still generating). getAgentRun already authorized ownership.
  if (res.run.kind === "prd") {
    const pid = res.run.projectId;
    redirect(
      res.run.prdId && pid
        ? `/b/projects/${pid}/prd/${res.run.prdId}`
        : pid
          ? `/b/projects/${pid}`
          : "/b/projects"
    );
  }

  const engagements = await getMyEngagements();
  const clientName =
    engagements.find((e) => e.id === res.run.engagementId)?.title || "this client";

  return (
    <main className="krowe-page">
      <div className="krowe-page-inner max-w-3xl">
        <AgentWorkspace run={res.run} messages={res.messages} clientName={clientName} />
      </div>
    </main>
  );
}
