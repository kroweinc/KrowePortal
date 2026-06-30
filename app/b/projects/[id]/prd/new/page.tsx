import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { getProjectById } from "@/lib/actions/projects";
import { getProjectSopTranscripts } from "@/lib/actions/project-sop";
import { PrdWizard } from "@/components/prd/prd-wizard";
import { STREAMING_ENABLED } from "@/lib/ai/client";

export const metadata = { title: "New PRD" };

export default async function NewProjectPrdPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") redirect("/o");

  const { id } = await params;
  const [project, sopTranscripts] = await Promise.all([
    getProjectById(id),
    getProjectSopTranscripts(id),
  ]);
  if (!project) notFound();

  return (
    <main className="krowe-page">
      <PrdWizard
        projectId={id}
        projectName={project.name}
        backHref={`/b/projects/${id}`}
        initialTitle={`${project.name} — PRD`}
        initialSopTranscripts={sopTranscripts}
        streamingEnabled={STREAMING_ENABLED}
      />
    </main>
  );
}
