import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { getProjectById } from "@/lib/actions/projects";
import { getPrdsByProject } from "@/lib/actions/prds";
import { getQuotesByProject } from "@/lib/actions/quote-docs";
import { createContractDraft } from "@/lib/actions/contracts";
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

export const metadata = { title: "New Contract" };

export default async function NewProjectContractPage({
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
        <h1 className="text-2xl font-semibold text-neutral-900 mb-1 mt-3">New contract</h1>
        <p className="text-sm text-neutral-500 mb-6">
          Pick the quote and PRD to build from, add any extra terms, and AI drafts a services
          agreement (kept consistent with the quote) you can edit before sending.
        </p>
        <NewContractForm
          action={createContractDraft}
          projectId={id}
          initialTitle={`${project.name} — Services Agreement`}
          quotes={quoteOptions}
          prds={prdOptions}
          defaultQuoteId={pickDefault(quotes)}
          defaultPrdId={pickDefault(prds)}
        />
      </div>
    </main>
  );
}
