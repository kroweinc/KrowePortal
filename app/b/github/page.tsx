import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { getUserGithubConnection } from "@/lib/github/token";
import { buildRepoContext } from "@/lib/github/repo-context";
import { buildBranchGraph, type BranchGraph } from "@/lib/github/branches";
import {
  getProjectProfile,
  type ProjectProfile,
} from "@/lib/actions/generate-project-profile";
import { getMyEngagement } from "@/lib/actions/invitations";
import {
  BranchesCard,
  BranchesCardSkeleton,
  CommitsCard,
  CommitsCardSkeleton,
  OverviewCard,
  OverviewCardSkeleton,
  ProjectHeader,
  ReadmeCard,
  StructureCard,
  TechStackCard,
  TechStackCardSkeleton,
  type OverviewStats,
} from "@/components/operator-project-profile";
import { Icon } from "@/components/operator-project-profile/icon";
import {
  NotConnected,
  NoRepoSelected,
  RepoFetchError,
} from "@/components/project-profile";
import { deriveArchLayers } from "@/lib/operator-project/derive-arch-layers";
import type { RepoContext } from "@/lib/github/types";

export default async function ProjectProfilePage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") redirect("/o");

  const connection = await getUserGithubConnection(profile.id);

  if (!connection) {
    return (
      <main className="krowe-page krowe-blueprint-canvas">
        <div className="krowe-page-inner anim-fade-up" style={{ maxWidth: 1180 }}>
          <NotConnected />
        </div>
      </main>
    );
  }

  if (!connection.selectedRepo) {
    return (
      <main className="krowe-page krowe-blueprint-canvas">
        <div className="krowe-page-inner anim-fade-up" style={{ maxWidth: 1180 }}>
          <NoRepoSelected />
        </div>
      </main>
    );
  }

  const { owner, name, defaultBranch, fullName } = connection.selectedRepo;

  const [repoContext, branchGraph, engagement] = await Promise.all([
    buildRepoContext(connection.token, owner, name, defaultBranch),
    buildBranchGraph(connection.token, owner, name, defaultBranch),
    getMyEngagement(),
  ]);

  if (!repoContext) {
    return (
      <main className="krowe-page krowe-blueprint-canvas">
        <div className="krowe-page-inner anim-fade-up" style={{ maxWidth: 1180 }}>
          <RepoFetchError repoFullName={fullName} />
        </div>
      </main>
    );
  }

  const toolContext = {
    token: connection.token,
    owner,
    repo: name,
    ref: defaultBranch,
  };

  const profilePromise: Promise<ProjectProfile | null> = getProjectProfile(
    repoContext,
    toolContext
  );

  const repoUrl = `https://github.com/${owner}/${name}`;
  const readmeUrl = `${repoUrl}/blob/${defaultBranch}/README.md`;

  const commits14d = repoContext.recentCommits.filter((c) => {
    const t = new Date(c.date).getTime();
    return !Number.isNaN(t) && Date.now() - t < 14 * 86_400_000;
  }).length;
  const contributors = new Set(
    repoContext.recentCommits
      .map((c) => c.author?.login ?? c.author?.name ?? null)
      .filter((v): v is string => Boolean(v))
  ).size;

  const branchGraphPromise: Promise<BranchGraph | null> = Promise.resolve(branchGraph);
  const statsPromise: Promise<OverviewStats> = branchGraphPromise.then((graph) => ({
    commits14d,
    contributors,
    branchCount: graph ? graph.root.children.length + 1 : 0,
    lastSyncIso: new Date().toISOString(),
  }));

  const archLayersPromise = profilePromise.then((p) => deriveArchLayers(repoContext, p));

  // Title: prefer engagement title (the operator's chosen name) when paired,
  // otherwise fall back to the repo name.
  const title = engagement?.title ?? name;
  const operatorName = engagement?.operator?.display_name ?? null;

  return (
    <main className="krowe-page krowe-blueprint-canvas">
      <div
        className="krowe-page-inner anim-fade-up"
        style={{ maxWidth: 1180, display: "flex", flexDirection: "column", gap: 20 }}
      >
        <ProjectHeader
          title={title}
          org={owner}
          repoName={name}
          tagline={repoContext.description}
          branch={defaultBranch}
          repoUrl={repoUrl}
          builderName={operatorName ? `for ${operatorName}` : profile.display_name}
          startedAt={engagement?.created_at ?? new Date().toISOString()}
        />

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

        <div
          style={{
            paddingTop: 4,
            display: "flex",
            gap: 18,
            flexWrap: "wrap",
          }}
        >
          <Link
            href="/b"
            className="dashed-link"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13.5,
              fontWeight: 500,
            }}
          >
            See your build board
            <Icon name="arrow" size={13} color="currentColor" />
          </Link>
          <Link
            href="/b/github/settings"
            className="dashed-link"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13.5,
              fontWeight: 500,
            }}
          >
            GitHub settings
            <Icon name="settings" size={13} color="currentColor" />
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
