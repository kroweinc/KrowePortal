import { Fragment } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  FileText,
  Receipt,
  FileSignature,
  ChevronRight,
  Hammer,
  Rocket,
  Plus,
} from "lucide-react";
import { getCurrentProfile } from "@/lib/auth";
import { getProjectById } from "@/lib/actions/projects";
import { getPrdsByProject } from "@/lib/actions/prds";
import { getQuotesByProject } from "@/lib/actions/quote-docs";
import { getContractsByProject } from "@/lib/actions/contracts";
import { getProjectMaterials } from "@/lib/actions/project-materials";
import { getProjectSopTranscripts } from "@/lib/actions/project-sop";
import { getEngagementByProject } from "@/lib/actions/begin-engagement";
import { derivePipeline } from "@/lib/project/stage";
import { countSeedItems } from "@/lib/project/seed-from-quote";
import { safeExternalHref } from "@/lib/project/business-context";
import { docMeta, quoteDocMeta } from "@/lib/doc/doc-summary";
import { Button } from "@/components/ui/button";
import { EditProjectDialog } from "./edit-project-dialog";
import { ProjectMaterials } from "./project-materials";
import { ProjectSop } from "./project-sop";
import { PipelineStepper } from "./pipeline-stepper";
import { BeginEngagementDialog } from "./begin-engagement-dialog";
import type { Quote, DocStatus, Engagement } from "@/lib/types";

export const metadata = { title: "Project" };

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

  const [quoteDocs, prds, contracts, materials, sopTranscripts, engagement] = await Promise.all([
    getQuotesByProject(id),
    getPrdsByProject(id),
    getContractsByProject(id),
    getProjectMaterials(id),
    getProjectSopTranscripts(id),
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
      <div className="docov">
        <Link href="/b/projects" className="crumb">
          <span className="ci"><ArrowLeft size={15} strokeWidth={2} /></span>All documents
        </Link>

        <div className="doc-head">
          <div className="doc-headmain">
            <h1 className="doc-title">{project.name}</h1>

            {(project.prospect_name || project.prospect_email) && (
              <div className="doc-client">
                {project.prospect_name && <span>{project.prospect_name}</span>}
                {project.prospect_name && project.prospect_email && <span className="dot" />}
                {project.prospect_email && <span>{project.prospect_email}</span>}
              </div>
            )}

            {(project.website_url || project.linkedin_url) && (
              <div className="doc-links">
                {project.website_url && (
                  <a
                    className="doc-link"
                    href={safeExternalHref(project.website_url)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Website<span className="li"><ArrowUpRight size={14} strokeWidth={2} /></span>
                  </a>
                )}
                {project.linkedin_url && (
                  <a
                    className="doc-link"
                    href={safeExternalHref(project.linkedin_url)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    LinkedIn<span className="li"><ArrowUpRight size={14} strokeWidth={2} /></span>
                  </a>
                )}
              </div>
            )}
          </div>

          <EditProjectDialog project={project} />
        </div>

        <div data-tour="project-pipeline">
          <PipelineStepper pipeline={pipeline} />
        </div>

        <ProjectMaterials projectId={id} initialMaterials={materials} />

        <ProjectSop projectId={id} initialTranscripts={sopTranscripts} />

        <Section
          id="prd"
          tour="project-prd"
          title="PRD"
          desc="A product requirements document to align on scope."
          newHref={`/b/projects/${id}/prd/new`}
          newLabel="New PRD"
          empty="No PRD yet — this is usually where a deal starts."
        >
          {prds.map((p) => (
            <DocRow
              key={p.id}
              href={`/b/projects/${id}/prd/${p.id}`}
              icon={<FileText size={17} strokeWidth={1.9} />}
              title={p.title}
              status={p.status}
              meta={docMeta(p)}
            />
          ))}
        </Section>

        <Section
          id="quote"
          title="Quote Breakdown"
          desc="A priced product quote breakdown, generated from a PRD or notes."
          newHref={`/b/projects/${id}/quotes/new`}
          newLabel="New quote breakdown"
          empty="No quote breakdown yet."
        >
          {quoteDocs.map((q) => (
            <DocRow
              key={q.id}
              href={`/b/projects/${id}/quotes/${q.id}`}
              icon={<Receipt size={17} strokeWidth={1.9} />}
              title={q.title}
              status={q.status}
              meta={quoteDocMeta(q)}
            />
          ))}
        </Section>

        <Section
          id="contract"
          title="Contract"
          desc="A services agreement to bring on the client."
          newHref={`/b/projects/${id}/contract/new`}
          newLabel="New contract"
          empty="No contract yet."
        >
          {contracts.map((c) => (
            <DocRow
              key={c.id}
              href={`/b/projects/${id}/contract/${c.id}`}
              icon={<FileSignature size={17} strokeWidth={1.9} />}
              title={c.title}
              status={c.status}
              meta={docMeta(c)}
            />
          ))}
        </Section>

        <section id="engagement" data-tour="begin-engagement" className="section">
          <div className="sec-head">
            <div>
              <h2 className="sec-title">Client</h2>
              <p className="sec-desc">
                The live build — task board, repo, and client collaboration.
              </p>
            </div>
          </div>
          {engagement?.started_at ? (
            <EngagementCard engagement={engagement} />
          ) : (
            <div className="engage-empty">
              <span className="ee-ico"><Hammer size={20} strokeWidth={1.9} /></span>
              <p className="ee-copy">
                {pipeline.contractSigned
                  ? "The contract's signed. Spin up the task board to start the build."
                  : "The contract isn't signed yet — but you can start the build early."}
              </p>
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
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Chip({ status }: { status: DocStatus | Quote["status"] }) {
  const tone =
    status === "signed" || status === "accepted"
      ? "signed"
      : status === "sent"
        ? "sent"
        : status === "rejected"
          ? "rejected"
          : "draft";
  const label: Record<DocStatus | Quote["status"], string> = {
    draft: "Draft",
    sent: "Sent",
    signed: "Signed",
    accepted: "Accepted",
    rejected: "Rejected",
  };
  return (
    <span className={`chip chip-${tone}`}>
      <span className="cd" />
      {label[status]}
    </span>
  );
}

// Renders a " · "-joined doc-summary string as separator dots, styling any
// currency part (e.g. "$45,000") as a mono amount — matching the design.
function renderMeta(meta: string) {
  return meta.split(" · ").map((part, i) => (
    <Fragment key={i}>
      {i > 0 && <span className="sep" />}
      {part.startsWith("$") ? (
        <span className="amount">{part}</span>
      ) : (
        <span>{part}</span>
      )}
    </Fragment>
  ));
}

function DocRow({
  href,
  icon,
  title,
  status,
  meta,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  status: DocStatus | Quote["status"];
  meta: string;
}) {
  return (
    <Link href={href} className="row">
      <span className="row-ico">{icon}</span>
      <div className="row-main">
        <div className="row-titleline">
          <span className="row-name">{title}</span>
          <Chip status={status} />
        </div>
        <div className="row-sub">{renderMeta(meta)}</div>
      </div>
      <span className="row-go"><ChevronRight size={17} strokeWidth={2} /></span>
    </Link>
  );
}

function Section({
  id,
  tour,
  title,
  desc,
  newHref,
  newLabel,
  empty,
  children,
}: {
  id: string;
  tour?: string;
  title: string;
  desc: string;
  newHref: string;
  newLabel: string;
  empty: string;
  children: React.ReactNode;
}) {
  const items = Array.isArray(children) ? children : [children];
  const hasItems = items.some(Boolean);
  return (
    <section id={id} data-tour={tour} className="section">
      <div className="sec-head">
        <div>
          <h2 className="sec-title">{title}</h2>
          <p className="sec-desc">{desc}</p>
        </div>
        <Link href={newHref} className="sec-action">
          <span className="ai"><Plus size={14} strokeWidth={2.25} /></span>
          {newLabel}
        </Link>
      </div>
      {hasItems ? <div className="rows">{children}</div> : <div className="empty">{empty}</div>}
    </section>
  );
}

function EngagementCard({ engagement }: { engagement: Engagement }) {
  const connected = Boolean(engagement.operator_id);
  return (
    <div className="row static">
      <span className="row-ico"><Rocket size={17} strokeWidth={1.9} /></span>
      <div className="row-main">
        <div className="row-titleline">
          <span className="row-name">{engagement.title}</span>
          <span className={`chip ${connected ? "chip-signed" : "chip-sent"}`}>
            <span className="cd" />
            {connected ? "Client connected" : "Awaiting client"}
          </span>
        </div>
        <div className="row-sub">
          <span>{engagement.github_repo_full_name ?? "No repo linked yet"}</span>
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
  );
}
