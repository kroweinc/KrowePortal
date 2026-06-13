import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import {
  BranchesCard,
  BranchesCardSkeleton,
  CodeNotConnectedYet,
  CommitsCard,
  CommitsCardSkeleton,
  NoProjectYet,
  OverviewCard,
  OverviewCardSkeleton,
  ProjectHeader,
  ReadmeCard,
  StructureCard,
  TechStackCard,
  TechStackCardSkeleton,
  type OverviewStats,
} from "@/components/operator-project-profile";
import { getEngagementRepoById } from "@/lib/github/engagement-repo";
import { buildRepoContext } from "@/lib/github/repo-context";
import { buildBranchGraph, type BranchGraph } from "@/lib/github/branches";
import {
  getProjectProfile,
  type ProjectProfile,
} from "@/lib/actions/generate-project-profile";
import { deriveArchLayers } from "@/lib/operator-project/derive-arch-layers";
import type { RepoContext } from "@/lib/github/types";
import type { Engagement } from "@/lib/types";
import { Icon } from "@/components/operator-project-profile/icon";
import { getMilestonesForEngagement } from "@/lib/actions/milestones";
import { getSignedDocsForEngagement } from "@/lib/actions/operator-docs";
import { SignedQuoteCard } from "@/components/dashboard/signed-quote-card";
import { MilestoneProgressCard } from "@/components/dashboard/milestone-progress-card";
import {
  getInfraRecommendations,
  getDeliverables,
} from "@/lib/actions/engagement";
import { getChangeOrders } from "@/lib/actions/change-orders";
import { InfraCard } from "@/components/dashboard/infra-card";
import { DeliverablesCard } from "@/components/dashboard/deliverables-card";
import { ChangeOrdersCard } from "@/components/dashboard/change-orders-card";

export default async function OperatorProjectPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "operator") redirect("/b/github");

  const supabase = DEV_PROFILE_IDS.has(profile.id)
    ? createAdminClient()
    : await createClient();

  const { data: engagements } = await supabase
    .from("engagements")
    .select("*")
    .eq("operator_id", profile.id)
    .order("created_at", { ascending: false });

  const engagementList = (engagements ?? []) as Engagement[];
  let engagement: Engagement | undefined = engagementList[0];

  if (!engagement) {
    const { data: builderConnections } = await supabase
      .from("github_connections")
      .select("user_id")
      .not("selected_repo_name", "is", null);

    const builderIds = (builderConnections ?? [])
      .map((c) => c.user_id)
      .filter((id): id is string => Boolean(id));

    if (builderIds.length > 0) {
      const { data: fallback } = await supabase
        .from("engagements")
        .select("*")
        .in("builder_id", builderIds)
        .order("created_at", { ascending: false })
        .limit(1);
      engagement = (fallback?.[0] as Engagement | undefined) ?? undefined;
    }
  }

  if (!engagement) {
    return (
      <main className="krowe-page krowe-blueprint-canvas">
        <div className="krowe-page-inner anim-fade-up" style={{ maxWidth: 1180 }}>
          <NoProjectYet />
        </div>
      </main>
    );
  }

  const { data: builderRow } = await supabase
    .from("profiles")
    .select("id, display_name")
    .eq("id", engagement.builder_id)
    .maybeSingle();
  const builderName = builderRow?.display_name ?? null;

  // Engagement spine — provisioned from the signed quote (new project model).
  const [signedDocs, milestones] = await Promise.all([
    getSignedDocsForEngagement(engagement),
    getMilestonesForEngagement(engagement.id),
  ]);
  const signedQuote = signedDocs.quote;

  // Engagement detail cards (Phases 7–10).
  const [infra, deliverables, changeOrders] = await Promise.all([
    getInfraRecommendations(engagement.id),
    getDeliverables(engagement.id),
    getChangeOrders(engagement.id),
  ]);

  let profilePromise: Promise<ProjectProfile | null> = Promise.resolve(null);
  let branchGraphPromise: Promise<BranchGraph | null> = Promise.resolve(null);
  let repoContext: RepoContext | null = null;

  const engagementRepo = await getEngagementRepoById(engagement.id, profile.id);
  if (engagementRepo) {
    repoContext = await buildRepoContext(
      engagementRepo.token,
      engagementRepo.owner,
      engagementRepo.name,
      engagementRepo.defaultBranch
    );
    if (repoContext) {
      profilePromise = getProjectProfile(repoContext, {
        token: engagementRepo.token,
        owner: engagementRepo.owner,
        repo: engagementRepo.name,
        ref: engagementRepo.defaultBranch,
      });
    }
    branchGraphPromise = buildBranchGraph(
      engagementRepo.token,
      engagementRepo.owner,
      engagementRepo.name,
      engagementRepo.defaultBranch
    );
  }

  const hasRepo = repoContext !== null;
  const repoUrl = engagementRepo
    ? `https://github.com/${engagementRepo.owner}/${engagementRepo.name}`
    : null;
  const readmeUrl = engagementRepo
    ? `${repoUrl}/blob/${engagementRepo.defaultBranch}/README.md`
    : null;

  const commits14d = repoContext
    ? repoContext.recentCommits.filter((c) => {
        const t = new Date(c.date).getTime();
        return !Number.isNaN(t) && Date.now() - t < 14 * 86_400_000;
      }).length
    : 0;
  const contributors = repoContext
    ? new Set(
        repoContext.recentCommits
          .map((c) => c.author?.login ?? c.author?.name ?? null)
          .filter((v): v is string => Boolean(v))
      ).size
    : 0;

  const statsPromise: Promise<OverviewStats> = branchGraphPromise.then((graph) => ({
    commits14d,
    contributors,
    branchCount: graph ? graph.root.children.length + 1 : 0,
    lastSyncIso: new Date().toISOString(),
  }));

  const archLayersPromise = profilePromise.then((p) =>
    repoContext ? deriveArchLayers(repoContext, p) : []
  );

  return (
    <main className="krowe-page krowe-blueprint-canvas">
      <div
        className="krowe-page-inner anim-fade-up"
        style={{ maxWidth: 1180, display: "flex", flexDirection: "column", gap: 20 }}
      >
        <ProjectHeader
          title={engagement.title}
          org={engagementRepo?.owner ?? null}
          repoName={engagementRepo?.name ?? null}
          tagline={repoContext?.description ?? null}
          branch={engagementRepo?.defaultBranch ?? "main"}
          repoUrl={repoUrl}
          builderName={builderName}
          startedAt={engagement.created_at}
        />

        {(signedQuote || milestones.length > 0) && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
              gap: 20,
              alignItems: "start",
            }}
          >
            {signedQuote && (
              <SignedQuoteCard
                quote={signedQuote}
                contractToken={signedDocs.contract?.token ?? null}
                prdToken={signedDocs.prd?.token ?? null}
              />
            )}
            {milestones.length > 0 && <MilestoneProgressCard milestones={milestones} />}
          </div>
        )}

        {/* Engagement detail cards (Phases 7–10) */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
            gap: 20,
            alignItems: "start",
          }}
        >
          <InfraCard recommendations={infra} canOverride />
          <DeliverablesCard deliverables={deliverables} />
          <ChangeOrdersCard changeOrders={changeOrders} canSign />
        </div>

        {hasRepo && repoContext ? (
          <>
            <Suspense fallback={<OverviewCardSkeleton />}>
              <OverviewCard profilePromise={profilePromise} statsPromise={statsPromise} />
            </Suspense>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1.15fr) minmax(0, 1fr)",
                gap: 20,
              }}
            >
              <Suspense fallback={<CommitsCardSkeleton />}>
                <CommitsCard commits={repoContext.recentCommits} />
              </Suspense>
              <Suspense fallback={<TechStackCardSkeleton />}>
                <AsyncTechStackCard
                  languages={repoContext.languages}
                  layersPromise={archLayersPromise}
                />
              </Suspense>
            </div>

            <Suspense fallback={<BranchesCardSkeleton />}>
              <BranchesCard graphPromise={branchGraphPromise} />
            </Suspense>

            <StructureCard entries={repoContext.topLevelTree} />

            <ReadmeCard markdown={repoContext.readmeExcerpt} readmeUrl={readmeUrl} />
          </>
        ) : (
          <CodeNotConnectedYet />
        )}

        <div style={{ paddingTop: 4 }}>
          <Link
            href="/o"
            className="dashed-link"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13.5,
              fontWeight: 500,
            }}
          >
            See task progress
            <Icon name="arrow" size={13} color="currentColor" />
          </Link>
        </div>
      </div>
    </main>
  );
}

async function AsyncTechStackCard({
  languages,
  layersPromise,
}: {
  languages: RepoContext["languages"];
  layersPromise: Promise<ReturnType<typeof deriveArchLayers>>;
}) {
  const layers = await layersPromise;
  return <TechStackCard languages={languages} layers={layers} />;
}
