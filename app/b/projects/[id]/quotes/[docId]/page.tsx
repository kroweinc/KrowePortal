import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { getProjectById } from "@/lib/actions/projects";
import { getQuoteById } from "@/lib/actions/quote-docs";
import { QuoteDashboard } from "@/components/quote/dashboard/quote-dashboard";
import { BusinessContactCard } from "@/components/doc/business-contact-card";

export default async function ProjectQuotePage({
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

  const quote = await getQuoteById(docId);
  if (!quote || quote.project_id !== id) notFound();

  return (
    <main className="krowe-page">
      <div className="krowe-page-inner">
        <BusinessContactCard contact={project} label="Prepared for" variant="card" className="mb-6" />
        <QuoteDashboard quote={quote} backHref={`/b/projects/${id}`} projectName={project.name} />
      </div>
    </main>
  );
}
