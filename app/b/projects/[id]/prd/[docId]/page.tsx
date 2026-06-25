import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { getProjectById } from "@/lib/actions/projects";
import { getPrdById } from "@/lib/actions/prds";
import { PrdDashboard } from "@/components/prd/dashboard/prd-dashboard";

export const metadata = { title: "PRD" };

export default async function ProjectPrdPage({
  params,
}: {
  params: Promise<{ id: string; docId: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") redirect("/o");

  const { id, docId } = await params;
  const project = await getProjectById(id);
  if (!project) notFound();

  const prd = await getPrdById(docId);
  if (!prd || prd.project_id !== id) notFound();

  return (
    <main className="krowe-page">
      <div className="krowe-page-inner">
        <PrdDashboard
          prd={prd}
          backHref={`/b/projects/${id}`}
          projectName={project.name}
        />
      </div>
    </main>
  );
}
