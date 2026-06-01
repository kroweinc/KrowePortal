import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { getProjectById } from "@/lib/actions/projects";
import { PrdWizard } from "@/components/prd/prd-wizard";

export default async function NewProjectPrdPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") redirect("/o");

  const { id } = await params;
  const project = await getProjectById(id);
  if (!project) notFound();

  return (
    <main className="krowe-page">
      <div className="krowe-page-inner max-w-2xl">
        <PrdWizard
          projectId={id}
          projectName={project.name}
          backHref={`/b/projects/${id}`}
          initialTitle={`${project.name} — PRD`}
        />
      </div>
    </main>
  );
}
