import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { getProjectById } from "@/lib/actions/projects";
import { getPrdsByProject } from "@/lib/actions/prds";
import { getQuotesByProject } from "@/lib/actions/quote-docs";
import { createContractDraft, getContractById } from "@/lib/actions/contracts";
import { NewContractForm, type ContractDocOption } from "@/components/contract/new-contract-form";

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtPrice(n?: number | null): string | undefined {
  if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

// Preselect the strongest source so the common case is one click: a
// signed/accepted doc, else the most recently sent, else the newest.
function pickDefault(items: { id: string; status: string }[]): string {
  return (
    (items.find((i) => i.status === "signed" || i.status === "accepted") ??
      items.find((i) => i.status === "sent") ??
      items[0])?.id ?? ""
  );
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ regenerate?: string }>;
}) {
  const { regenerate } = await searchParams;
  return { title: regenerate ? "Regenerate Contract" : "New Contract" };
}

export default async function NewProjectContractPage({
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
  const project = await getProjectById(id);
  if (!project) notFound();

  // Regenerate: re-run the form over an existing draft, replacing it in place. Only
  // the builder's own draft in THIS project qualifies — anything else (a sent
  // contract, another project's, a stale id) bounces back rather than silently
  // falling through to a blank form, which would create a second document.
  // Contracts don't record which quote/PRD they were drafted from, so the pickers
  // below fall back to their usual "strongest source" default.
  let regenerateId: string | null = null;
  let initialTitle = `${project.name} — Services Agreement`;
  let initialNotes: string | null = null;
  if (regenerate) {
    const contract = await getContractById(regenerate);
    if (!contract || contract.project_id !== id || contract.status !== "draft") {
      redirect(`/b/projects/${id}`);
    }
    regenerateId = contract.id;
    initialTitle = contract.title;
    initialNotes = contract.source_notes;
  }

  // Both actions return rows ordered created_at desc (most recent first).
  const [quotes, prds] = await Promise.all([getQuotesByProject(id), getPrdsByProject(id)]);

  const quoteOptions: ContractDocOption[] = quotes.map((q) => ({
    id: q.id,
    title: q.title,
    status: q.status,
    createdLabel: fmtDateTime(q.created_at),
    priceLabel: fmtPrice(q.content?.totals?.grand),
  }));
  const prdOptions: ContractDocOption[] = prds.map((p) => ({
    id: p.id,
    title: p.title,
    status: p.status,
    createdLabel: fmtDateTime(p.created_at),
  }));

  return (
    <main className="krowe-page">
      <div className="krowe-page-inner max-w-2xl">
        <Link href={`/b/projects/${id}`} className="text-xs text-neutral-500 hover:text-neutral-900">
          ← {project.name}
        </Link>
        <h1 className="text-2xl font-semibold text-neutral-900 mb-1 mt-3">
          {regenerateId ? "Regenerate contract" : "New contract"}
        </h1>
        <p className="text-sm text-neutral-500 mb-6">
          {regenerateId
            ? "Confirm the quote and PRD to build from and adjust the terms, then AI redrafts the agreement. Finishing replaces the current draft — its share link stays the same."
            : "Pick the quote and PRD to build from, add any extra terms, and AI drafts a services agreement (kept consistent with the quote) you can edit before sending."}
        </p>
        <NewContractForm
          action={createContractDraft}
          projectId={id}
          initialTitle={initialTitle}
          quotes={quoteOptions}
          prds={prdOptions}
          defaultQuoteId={pickDefault(quotes)}
          defaultPrdId={pickDefault(prds)}
          regenerateId={regenerateId}
          initialNotes={initialNotes}
        />
      </div>
    </main>
  );
}
