import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getMyPendingInvites } from "@/lib/actions/invitations";
import { getPrdsByProject } from "@/lib/actions/prds";
import { getQuotesByProject } from "@/lib/actions/quote-docs";
import { getContractsByProject } from "@/lib/actions/contracts";
import { EngagementSettingsCard } from "@/components/engagement-admin/engagement-settings-card";
import { DeleteEngagementCard } from "@/components/engagement-admin/delete-engagement-card";
import { RepoSelector } from "@/components/github/repo-selector";
import { BusinessContactCard } from "@/components/doc/business-contact-card";
import {
  EngagementDocuments,
  type EngagementDocItem,
} from "@/components/doc/engagement-documents";
import { docMeta, quoteDocMeta } from "@/lib/doc/doc-summary";
import type { Engagement } from "@/lib/types";

export default async function BuilderEngagementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") redirect("/o/project");

  const { id } = await params;

  const supabase = DEV_PROFILE_IDS.has(profile.id)
    ? createAdminClient()
    : await createClient();

  const { data } = await supabase
    .from("engagements")
    .select(
      "*, operator:profiles!operator_id(display_name), project:projects(id, name, prospect_name, prospect_email, website_url, linkedin_url, live_url, context)"
    )
    .eq("id", id)
    .eq("builder_id", profile.id)
    .maybeSingle();

  if (!data) notFound();
  const engagement = data as Engagement;

  const [pendingInvites, ghConnection] = await Promise.all([
    getMyPendingInvites(),
    supabase
      .from("github_connections")
      .select("id")
      .eq("user_id", profile.id)
      .maybeSingle()
      .then(({ data }) => data),
  ]);

  const operatorName = engagement.operator?.display_name ?? null;
  const pendingInvite = pendingInvites[engagement.id] ?? null;

  // Documents follow the engagement through its project link — they live on the
  // project, and an engagement is 1:1 with its project. The builder owns both,
  // so the owner-scoped fetchers read them directly.
  const projectId = engagement.project_id ?? null;
  let docItems: EngagementDocItem[] = [];
  if (projectId) {
    const [prds, quotes, contracts] = await Promise.all([
      getPrdsByProject(projectId),
      getQuotesByProject(projectId),
      getContractsByProject(projectId),
    ]);
    docItems = [
      ...prds.map((p) => ({
        id: p.id,
        title: p.title,
        status: p.status,
        meta: docMeta(p),
        href: `/b/projects/${projectId}/prd/${p.id}`,
      })),
      ...quotes.map((q) => ({
        id: q.id,
        title: q.title,
        status: q.status,
        meta: quoteDocMeta(q),
        href: `/b/projects/${projectId}/quotes/${q.id}`,
      })),
      ...contracts.map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        meta: docMeta(c),
        href: `/b/projects/${projectId}/contract/${c.id}`,
      })),
    ];
  }

  return (
    <main className="krowe-page">
      <div className="krowe-page-inner max-w-3xl space-y-6">
        <Link href="/b/engagements" className="text-xs text-neutral-500 hover:text-neutral-900">
          ← Engagements
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">{engagement.title}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {operatorName
              ? `Controls ${operatorName} sees on their dashboard.`
              : "Controls the operator sees on their dashboard once they join."}
          </p>
        </div>

        {engagement.project && (
          <Section title="Business contact" hint="The prospect this engagement is for.">
            <BusinessContactCard contact={engagement.project} variant="inline" />
          </Section>
        )}

        <Section
          title="Documents"
          hint="The PRD, quote, and contract from the project this engagement came from."
        >
          <EngagementDocuments items={docItems} emptyLabel="No documents yet." />
        </Section>

        <Section title="Settings" hint="Rename or manage the operator invite.">
          <EngagementSettingsCard engagement={engagement} pendingInvite={pendingInvite} />
        </Section>

        <Section
          title="GitHub repository"
          hint="The repo for this engagement — powers its project view, commits, and branches."
        >
          {ghConnection ? (
            <div className="space-y-2">
              <RepoSelector
                engagementId={engagement.id}
                currentRepo={engagement.github_repo_full_name ?? null}
              />
              {engagement.github_repo_full_name && (
                <Link
                  href={`/b/github?engagement=${engagement.id}`}
                  className="inline-block text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-900"
                >
                  View repo →
                </Link>
              )}
            </div>
          ) : (
            <p className="text-sm text-neutral-500">
              <Link
                href="/b/github/settings"
                className="text-neutral-700 underline underline-offset-2 hover:text-neutral-900"
              >
                Connect GitHub
              </Link>{" "}
              first to link a repository to this engagement.
            </p>
          )}
        </Section>

        <Section title="Danger zone" hint="Permanently delete this engagement.">
          <DeleteEngagementCard engagement={engagement} />
        </Section>
      </div>
    </main>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
        {hint && <p className="text-xs text-neutral-500">{hint}</p>}
      </div>
      {children}
    </section>
  );
}
