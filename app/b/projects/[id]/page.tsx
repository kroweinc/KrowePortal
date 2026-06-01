import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { getProjectById } from "@/lib/actions/projects";
import { getBriefsByProject } from "@/lib/actions/briefs";
import { getPrdsByProject } from "@/lib/actions/prds";
import { getContractsByProject } from "@/lib/actions/contracts";
import { Ember } from "@/components/design-atoms";
import { Button } from "@/components/ui/button";
import { BriefStatusPill } from "@/components/brief/brief-status-pill";
import { EditProjectDialog } from "./edit-project-dialog";
import type { Brief, Prd, Contract, DocStatus } from "@/lib/types";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

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

  const [quotes, prds, contracts] = await Promise.all([
    getBriefsByProject(id),
    getPrdsByProject(id),
    getContractsByProject(id),
  ]);

  return (
    <main className="krowe-page">
      <div className="krowe-page-inner max-w-3xl">
        <Link href="/b/projects" className="text-xs text-neutral-500 hover:text-neutral-900">
          ← All projects
        </Link>

        <div className="mt-3 mb-8">
          <div className="flex items-start justify-between gap-4">
            <h1 className="krowe-page-title">
              <Ember size={22} /> {project.name}
            </h1>
            <EditProjectDialog project={project} />
          </div>
          {(project.prospect_name || project.prospect_email) && (
            <p className="text-sm text-neutral-500 mt-1">
              {project.prospect_name}
              {project.prospect_name && project.prospect_email ? " · " : ""}
              {project.prospect_email}
            </p>
          )}
          {project.context && (
            <p className="text-sm text-neutral-600 mt-3 whitespace-pre-wrap">{project.context}</p>
          )}
        </div>

        <div className="space-y-8">
          <DocSection
            title="Quote"
            blurb="A priced proposal / statement of work."
            newHref={`/b/projects/${id}/quote/new`}
            empty="No quote yet."
          >
            {quotes.map((q) => (
              <DocRow
                key={q.id}
                href={`/b/projects/${id}/quote/${q.id}`}
                title={q.title}
                status={q.status}
                meta={quoteMeta(q)}
              />
            ))}
          </DocSection>

          <DocSection
            title="PRD"
            blurb="A product requirements document to align on scope."
            newHref={`/b/projects/${id}/prd/new`}
            empty="No PRD yet."
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
        </div>
      </div>
    </main>
  );
}

function quoteMeta(q: Brief): string {
  const total = q.content.totals?.grand;
  const parts: string[] = [`Created ${formatDate(q.created_at)}`];
  if (q.signed_at) parts.push(`Signed ${formatDate(q.signed_at)}`);
  else if (q.sent_at) parts.push(`Sent ${formatDate(q.sent_at)}`);
  if (typeof total === "number" && total > 0) {
    parts.push(total.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
  }
  return parts.join(" · ");
}

function docMeta(d: Prd | Contract): string {
  const parts: string[] = [`Created ${formatDate(d.created_at)}`];
  if (d.signed_at) parts.push(`Signed ${formatDate(d.signed_at)}`);
  else if (d.sent_at) parts.push(`Sent ${formatDate(d.sent_at)}`);
  return parts.join(" · ");
}

function DocSection({
  title,
  blurb,
  newHref,
  empty,
  children,
}: {
  title: string;
  blurb: string;
  newHref: string;
  empty: string;
  children: React.ReactNode;
}) {
  const items = Array.isArray(children) ? children : [children];
  const hasItems = items.some(Boolean);
  return (
    <section>
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
  status: DocStatus | Brief["status"];
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
