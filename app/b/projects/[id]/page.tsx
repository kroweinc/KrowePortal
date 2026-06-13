import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { getProjectById } from "@/lib/actions/projects";
import { getPrdsByProject } from "@/lib/actions/prds";
import { getQuotesByProject } from "@/lib/actions/quote-docs";
import { getContractsByProject } from "@/lib/actions/contracts";
import { getProjectMaterials } from "@/lib/actions/project-materials";
import { getEngagementByProject } from "@/lib/actions/begin-engagement";
import { derivePipeline } from "@/lib/project/stage";
import { countSeedItems } from "@/lib/project/seed-from-quote";
import { Ember } from "@/components/design-atoms";
import { BusinessContactCard } from "@/components/doc/business-contact-card";
import { docMeta, quoteDocMeta } from "@/lib/doc/doc-summary";
import { Button } from "@/components/ui/button";
import { BriefStatusPill } from "@/components/brief/brief-status-pill";
import { EditProjectDialog } from "./edit-project-dialog";
import { ProjectMaterials } from "./project-materials";
import { PipelineStepper } from "./pipeline-stepper";
import { BeginEngagementDialog } from "./begin-engagement-dialog";
import type { Quote, Contract, DocStatus, Engagement } from "@/lib/types";

export default async function ProjectDetailPage({
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

  const [quoteDocs, prds, contracts, materials, engagement] = await Promise.all([
    getQuotesByProject(id),
    getPrdsByProject(id),
    getContractsByProject(id),
    getProjectMaterials(id),
    getEngagementByProject(id),
  ]);

  const pipeline = derivePipeline({ prds, quotes: quoteDocs, contracts, engagement });

  // Newest signed/accepted quote — the seeding source shown in the dialog.
  const signedQuoteDoc =
    quoteDocs
      .filter((q) => q.status === "signed" || q.status === "accepted")
      .sort((a, b) => (b.signed_at ?? "").localeCompare(a.signed_at ?? ""))[0] ?? null;
  const seedCounts = signedQuoteDoc ? countSeedItems(signedQuoteDoc.content ?? {}) : null;

  return (
    <main className="krowe-page">
      <div className="krowe-page-inner max-w-3xl">
        <Link href="/b/projects" className="text-xs text-neutral-500 hover:text-neutral-900">
          ← All documents
        </Link>

        <div className="mt-3 mb-6">
          <div className="flex items-start justify-between gap-4">
            <h1 className="krowe-page-title">
              <Ember size={22} /> {project.name}
            </h1>
            <EditProjectDialog project={project} />
          </div>
          <BusinessContactCard contact={project} variant="inline" className="mt-1" />
        </div>

        <div className="mb-8">
          <PipelineStepper pipeline={pipeline} />
        </div>

        <div className="space-y-8">
          <ProjectMaterials projectId={id} initialMaterials={materials} />

          <DocSection
            id="prd"
            title="PRD"
            blurb="A product requirements document to align on scope."
            newHref={`/b/projects/${id}/prd/new`}
            empty="No PRD yet — this is usually where a deal starts."
          >
            {prds.map((p) => (
              <DocRow
                key={p.id}
                href={`/b/projects/${id}/prd/${p.id}`}
                title={p.title}
                status={p.status}
                meta={docMeta(p)}
              />
            ))}
          </DocSection>

          <DocSection
            id="quote"
            title="Quote Breakdown"
            blurb="A priced product quote breakdown, generated from a PRD or notes."
            newHref={`/b/projects/${id}/quotes/new`}
            empty="No quote breakdown yet."
          >
            {quoteDocs.map((q) => (
              <DocRow
                key={q.id}
                href={`/b/projects/${id}/quotes/${q.id}`}
                title={q.title}
                status={q.status}
                meta={quoteDocMeta(q)}
              />
            ))}
          </DocSection>

          <DocSection
            id="contract"
            title="Contract"
            blurb="A services agreement to execute the engagement."
            newHref={`/b/projects/${id}/contract/new`}
            empty="No contract yet."
          >
            {contracts.map((c) => (
              <DocRow
                key={c.id}
                href={`/b/projects/${id}/contract/${c.id}`}
                title={c.title}
                status={c.status}
                meta={docMeta(c)}
              />
            ))}
          </DocSection>

          <section id="engagement">
            <div className="flex items-center justify-between gap-4 mb-2">
              <div>
                <h2 className="text-sm font-semibold text-neutral-900">Engagement</h2>
                <p className="text-xs text-neutral-500">
                  The live build — task board, repo, and client collaboration.
                </p>
              </div>
              {!engagement && (
                <BeginEngagementDialog
                  projectId={id}
                  projectName={project.name}
                  prospectEmail={project.prospect_email}
                  contractSigned={pipeline.contractSigned}
                  signedQuote={
                    signedQuoteDoc && seedCounts
                      ? {
                          title: signedQuoteDoc.title,
                          milestoneCount: seedCounts.milestones,
                          taskCount: seedCounts.tasks,
                        }
                      : null
                  }
                />
              )}
            </div>
            {engagement ? (
              <EngagementCard engagement={engagement} />
            ) : (
              <div className="rounded-lg border border-dashed border-neutral-200 bg-white px-4 py-4 text-xs text-neutral-400">
                {pipeline.contractSigned
                  ? "Contract signed — begin the engagement to spin up the task board."
                  : "Once the contract is signed, begin the engagement here."}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function EngagementCard({ engagement }: { engagement: Engagement }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-medium text-neutral-900 truncate">
              {engagement.title}
            </span>
            <span
              className={`inline-flex items-center gap-1 text-[11px] ${
                engagement.operator_id ? "text-emerald-600" : "text-amber-600"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  engagement.operator_id ? "bg-emerald-500" : "bg-amber-500"
                }`}
              />
              {engagement.operator_id ? "Client connected" : "Awaiting client"}
            </span>
          </div>
          <div className="text-xs text-neutral-500">
            {engagement.github_repo_full_name
              ? engagement.github_repo_full_name
              : "No repo linked yet"}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link href={`/b?engagement=${engagement.id}`}>
            <Button variant="outline" size="sm">Tasks</Button>
          </Link>
          <Link href={`/b/github?engagement=${engagement.id}`}>
            <Button variant="outline" size="sm">
              {engagement.github_repo_full_name ? "Repo" : "Link repo"}
            </Button>
          </Link>
          <Link href={`/b/engagements/${engagement.id}`}>
            <Button variant="outline" size="sm">Manage</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

function DocSection({
  id,
  title,
  blurb,
  newHref,
  empty,
  children,
}: {
  id: string;
  title: string;
  blurb: string;
  newHref: string;
  empty: string;
  children: React.ReactNode;
}) {
  const items = Array.isArray(children) ? children : [children];
  const hasItems = items.some(Boolean);
  return (
    <section id={id}>
      <div className="flex items-center justify-between gap-4 mb-2">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
          <p className="text-xs text-neutral-500">{blurb}</p>
        </div>
        <Link href={newHref}>
          <Button variant="outline" size="sm">+ New {title.toLowerCase()}</Button>
        </Link>
      </div>
      {hasItems ? (
        <div className="space-y-2">{children}</div>
      ) : (
        <div className="rounded-lg border border-dashed border-neutral-200 bg-white px-4 py-4 text-xs text-neutral-400">
          {empty}
        </div>
      )}
    </section>
  );
}

function DocRow({
  href,
  title,
  status,
  meta,
}: {
  href: string;
  title: string;
  status: DocStatus | Quote["status"];
  meta: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-4 rounded-lg border border-neutral-200 bg-white px-4 py-3 hover:border-neutral-300 transition-colors"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-medium text-neutral-900 truncate">{title}</span>
          <BriefStatusPill status={status} />
        </div>
        <div className="text-xs text-neutral-500">{meta}</div>
      </div>
    </Link>
  );
}
