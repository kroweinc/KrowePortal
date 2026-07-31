import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { getProjectById } from "@/lib/actions/projects";
import { getProjectSopTranscripts } from "@/lib/actions/project-sop";
import { getPrdById } from "@/lib/actions/prds";
import { PrdWizard } from "@/components/prd/prd-wizard";
import { STREAMING_ENABLED } from "@/lib/ai/client";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ regenerate?: string }>;
}) {
  const { regenerate } = await searchParams;
  return { title: regenerate ? "Regenerate PRD" : "New PRD" };
}

export default async function NewProjectPrdPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ regenerate?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") redirect("/o");

  const { id } = await params;
  const { regenerate } = await searchParams;
  const [project, sopTranscripts] = await Promise.all([
    getProjectById(id),
    getProjectSopTranscripts(id),
  ]);
  if (!project) notFound();

  // Regenerate: re-run the wizard over an existing draft, replacing it in place.
  // Only the builder's own draft in THIS project qualifies — anything else (a sent
  // PRD, another project's, a stale id) bounces back rather than silently falling
  // through to a blank wizard, which would create a second document.
  let regenerateId: string | null = null;
  let initialTitle = `${project.name} — PRD`;
  if (regenerate) {
    const prd = await getPrdById(regenerate);
    if (!prd || prd.project_id !== id || prd.status !== "draft") redirect(`/b/projects/${id}`);
    regenerateId = prd.id;
    initialTitle = prd.title;
  }

  return (
    <main className="krowe-page">
      <PrdWizard
        projectId={id}
        projectName={project.name}
        backHref={`/b/projects/${id}`}
        initialTitle={initialTitle}
        initialSopTranscripts={sopTranscripts}
        regenerateId={regenerateId}
        streamingEnabled={STREAMING_ENABLED}
      />
    </main>
  );
}
