import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Briefcase, FileText, Github, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getMyPendingInvites } from "@/lib/actions/invitations";
import { getMyBuilderIdentity } from "@/lib/actions/builder-profile";
import { getPrdsByProject } from "@/lib/actions/prds";
import { getQuotesByProject } from "@/lib/actions/quote-docs";
import { getContractsByProject } from "@/lib/actions/contracts";
import { EngagementSettingsCard } from "@/components/engagement-admin/engagement-settings-card";
import { DeleteEngagementCard } from "@/components/engagement-admin/delete-engagement-card";
import { RepoSelector } from "@/components/github/repo-selector";
import { BusinessContactCard } from "@/components/doc/business-contact-card";
import { BusinessLinksEditor } from "@/components/engagement/business-links-editor";
import { DetailHero } from "@/components/engagement/detail-hero";
import { EngagementSection } from "@/components/engagement/engagement-section";
import type { EngagementStatusKind } from "@/components/engagement/engagement-status";
import {
  EngagementDocuments,
  type EngagementDocItem,
} from "@/components/doc/engagement-documents";
import { docMeta, quoteDocMeta } from "@/lib/doc/doc-summary";
import type { Engagement, TaskStatus } from "@/lib/types";

export const metadata = { title: "Client" };

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

  // Admin client for the operator embed: profiles_select RLS ("auth.uid() = id")
  // hides the operator's profile row from the builder, so under the RLS client
  // the embed returns null and the page reports the engagement as having no
  // operator. Ownership is enforced by the builder_id filter below.
  const admin = createAdminClient();
  const { data } = await admin
    .from("engagements")
    .select(
      "*, operator:profiles!operator_id(display_name), project:projects(id, name, prospect_name, prospect_email, website_url, linkedin_url, live_url, context)"
    )
    .eq("id", id)
    .eq("builder_id", profile.id)
    .maybeSingle();

  if (!data) notFound();
  const engagement = data as Engagement;

  const [pendingInvites, ghConnection, identity, taskRows] = await Promise.all([
    getMyPendingInvites(),
    supabase
      .from("github_connections")
      .select("id")
      .eq("user_id", profile.id)
      .maybeSingle()
      .then(({ data }) => data),
    getMyBuilderIdentity(),
    supabase
      .from("tasks")
      .select("status")
      .eq("engagement_id", id)
      .then(({ data }) => data ?? []),
  ]);

  const operatorName = engagement.operator?.display_name ?? null;
  const pendingInvite = pendingInvites[engagement.id] ?? null;

  let openCount = 0;
  let doneCount = 0;
  for (const row of taskRows) {
    if ((row.status as TaskStatus) === "done") doneCount += 1;
    else openCount += 1;
  }

  const statusKind: EngagementStatusKind = operatorName ? "live" : pendingInvite ? "pend" : "none";
  const statusLabel = operatorName
    ? `Connected with ${operatorName}`
    : pendingInvite
      ? "Invite pending"
      : "No operator yet";

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

  const heroSub = operatorName
    ? `Controls ${operatorName} sees on their dashboard.`
    : "Controls the operator sees on their dashboard once they join.";

  return (
    <main className="krowe-page">
      <div className="krowe-page-inner max-w-3xl">
        <div className="mb-4">
          <Link href="/b/engagements" className="eng-backlink">
            <ArrowLeft size={15} strokeWidth={1.75} /> Clients
          </Link>
        </div>

        <DetailHero
          id={engagement.id}
          title={engagement.title}
          sub={heroSub}
          websiteUrl={engagement.project?.website_url}
          businessName={engagement.project?.prospect_name ?? engagement.project?.name}
          statusKind={statusKind}
          statusLabel={statusLabel}
          repo={engagement.github_repo_full_name}
          open={openCount}
          done={doneCount}
          badgeUrl={identity?.avatarUrl ?? null}
          badgeInitials={identity?.initials ?? "•"}
        />

        <div className="eng-sections">
          <EngagementSection
            icon={<Briefcase size={19} strokeWidth={1.75} />}
            title="Business information"
            hint="Contact and links for this client — used on docs and the client dashboard."
          >
            {engagement.project_id && engagement.project && (
              <BusinessContactCard
                contact={engagement.project}
                variant="inline"
                showBrand
              />
            )}
            <BusinessLinksEditor
              engagementId={engagement.id}
              initialWebsite={engagement.project?.website_url ?? null}
              initialLinkedin={engagement.project?.linkedin_url ?? null}
              showTopBorder={!!(engagement.project_id && engagement.project)}
            />
          </EngagementSection>

          <EngagementSection
            icon={<FileText size={19} strokeWidth={1.75} />}
            title="Documents"
            hint="The PRD, quote, and contract from the project this client came from."
          >
            <EngagementDocuments items={docItems} emptyLabel="No documents yet." />
          </EngagementSection>

          <EngagementSection
            icon={<SlidersHorizontal size={19} strokeWidth={1.75} />}
            title="Settings"
            hint="Rename or manage the operator invite."
          >
            <EngagementSettingsCard engagement={engagement} pendingInvite={pendingInvite} />
          </EngagementSection>

          <EngagementSection
            icon={<Github size={19} strokeWidth={1.75} />}
            title="GitHub repository"
            hint="The repo for this client — powers its project view, commits, and branches."
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
                  href="/b/settings/github"
                  className="text-neutral-700 underline underline-offset-2 hover:text-neutral-900"
                >
                  Connect GitHub
                </Link>{" "}
                first to link a repository to this client.
              </p>
            )}
          </EngagementSection>

          <EngagementSection
            icon={<TriangleAlert size={19} strokeWidth={1.75} />}
            title="Danger zone"
            hint="Permanently delete this client."
            tone="danger"
          >
            <DeleteEngagementCard engagement={engagement} />
          </EngagementSection>
        </div>
      </div>
    </main>
  );
}
