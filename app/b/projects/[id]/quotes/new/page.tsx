import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { getProjectById } from "@/lib/actions/projects";
import { getPrdsByProject } from "@/lib/actions/prds";
import { getQuoteById } from "@/lib/actions/quote-docs";
import { QuoteWizard } from "@/components/quote/quote-wizard";
import { STREAMING_ENABLED } from "@/lib/ai/client";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ regenerate?: string }>;
}) {
  const { regenerate } = await searchParams;
  return { title: regenerate ? "Regenerate Quote" : "New Quote" };
}

export default async function NewProjectQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ fromPrd?: string; regenerate?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") redirect("/o");

  const { id } = await params;
  const { fromPrd, regenerate } = await searchParams;
  const project = await getProjectById(id);
  if (!project) notFound();

  const prds = await getPrdsByProject(id);
  const wizardPrds = prds.map((p) => ({ id: p.id, title: p.title, status: p.status }));
  // Only honor ?fromPrd when it actually belongs to this project.
  let initialPrdId = fromPrd && prds.some((p) => p.id === fromPrd) ? fromPrd : null;

  // Regenerate: re-run the wizard over an existing draft, replacing it in place.
  // Only the builder's own draft in THIS project qualifies — anything else (a sent
  // quote, another project's, a stale id) bounces back rather than silently falling
  // through to a blank wizard, which would create a second document.
  let regenerateId: string | null = null;
  let initialTitle = `${project.name} — Quote`;
  if (regenerate) {
    const quote = await getQuoteById(regenerate);
    if (!quote || quote.project_id !== id || quote.status !== "draft") redirect(`/b/projects/${id}`);
    regenerateId = quote.id;
    initialTitle = quote.title;
    // Reopen on the PRD the quote was originally priced from, when it still exists.
    if (quote.source_prd_id && prds.some((p) => p.id === quote.source_prd_id)) {
      initialPrdId = quote.source_prd_id;
    }
  }

  return (
    <main className="krowe-page">
      <div className="krowe-page-inner max-w-2xl">
        <QuoteWizard
          projectId={id}
          projectName={project.name}
          backHref={`/b/projects/${id}`}
          initialTitle={initialTitle}
          prds={wizardPrds}
          initialPrdId={initialPrdId}
          regenerateId={regenerateId}
          streamingEnabled={STREAMING_ENABLED}
        />
      </div>
    </main>
  );
}
