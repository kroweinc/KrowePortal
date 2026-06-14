import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { getProjectById } from "@/lib/actions/projects";
import { getPrdsByProject } from "@/lib/actions/prds";
import { QuoteWizard } from "@/components/quote/quote-wizard";

export const metadata = { title: "New Quote" };

export default async function NewProjectQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ fromPrd?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") redirect("/o");

  const { id } = await params;
  const { fromPrd } = await searchParams;
  const project = await getProjectById(id);
  if (!project) notFound();

  const prds = await getPrdsByProject(id);
  const wizardPrds = prds.map((p) => ({ id: p.id, title: p.title, status: p.status }));
  // Only honor ?fromPrd when it actually belongs to this project.
  const initialPrdId = fromPrd && prds.some((p) => p.id === fromPrd) ? fromPrd : null;

  return (
    <main className="krowe-page">
      <div className="krowe-page-inner max-w-2xl">
        <QuoteWizard
          projectId={id}
          projectName={project.name}
          backHref={`/b/projects/${id}`}
          initialTitle={`${project.name} — Quote`}
          prds={wizardPrds}
          initialPrdId={initialPrdId}
        />
      </div>
    </main>
  );
}
