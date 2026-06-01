import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { getProjectById } from "@/lib/actions/projects";
import { NewBriefForm } from "@/app/b/brief/new/new-brief-form";

export default async function NewProjectQuotePage({
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
        <Link href={`/b/projects/${id}`} className="text-xs text-neutral-500 hover:text-neutral-900">
          ← {project.name}
        </Link>
        <h1 className="text-2xl font-semibold text-neutral-900 mb-1 mt-3">New quote</h1>
        <p className="text-sm text-neutral-500 mb-6">
          Paste your discovery notes. AI drafts a starting point; you can edit anything before sending.
        </p>
        <NewBriefForm
          projectId={id}
          initialTitle={project.name}
          initialClientName={project.prospect_name ?? project.name}
        />
      </div>
    </main>
  );
}
