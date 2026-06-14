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
import { getMyEngagements } from "@/lib/actions/invitations";
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
import { RepoSelector } from "@/components/github/repo-selector";
import { fetchGithubRepos } from "@/lib/github/list-repos";
import { deriveArchLayers } from "@/lib/operator-project/derive-arch-layers";
import type { RepoContext } from "@/lib/github/types";
import type { Engagement } from "@/lib/types";

type RepoOption = {
  key: string; // engagement id, or "personal" for the user's own selected repo
  label: string;
  engagement: Engagement | null;
  repo: {
    owner: string;
    name: string;
    fullName: string;
    defaultBranch: string;
  } | null; // null = engagement exists but has no repo linked yet
};

export const metadata = { title: "Repo" };

export default async function ProjectProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ engagement?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") redirect("/o");

  const [connection, engagements, { engagement: engagementParam }] = await Promise.all([
    getUserGithubConnection(profile.id),
    getMyEngagements(),
    searchParams,
  ]);

  if (!connection) {
    return (
      <main className="krowe-page krowe-blueprint-canvas">
        <div className="krowe-page-inner anim-fade-up" style={{ maxWidth: 1180 }}>
          <NotConnected />
        </div>
      </main>
    );
  }

  // Every engagement gets a chip, even before a repo is linked.
  const engagementOptions: RepoOption[] = engagements.map((e) => ({
    key: e.id,
    label: e.title,
    engagement: e,
    repo:
      e.github_repo_owner && e.github_repo_name && e.github_default_branch
        ? {
            owner: e.github_repo_owner,
            name: e.github_repo_name,
            fullName:
              e.github_repo_full_name ?? `${e.github_repo_owner}/${e.github_repo_name}`,
            defaultBranch: e.github_default_branch,
          }
        : null,
  }));

  // The user's own selected repo, unless an engagement already covers it.
  const personalOption: RepoOption | null =
    connection.selectedRepo &&
    !engagementOptions.some((o) => o.repo?.fullName === connection.selectedRepo!.fullName)
      ? {
          key: "personal",
          label: "Personal",
          engagement: null,
          repo: connection.selectedRepo,
        }
      : null;

  // Linked repos first; engagements still waiting on a repo sort to the right.
  const repoOptions = [
    ...engagementOptions.filter((o) => o.repo),
    ...(personalOption ? [personalOption] : []),
    ...engagementOptions.filter((o) => !o.repo),
  ];

  if (repoOptions.length === 0) {
    return (
      <main className="krowe-page krowe-blueprint-canvas">
        <div className="krowe-page-inner anim-fade-up" style={{ maxWidth: 1180 }}>
          <NoRepoSelected />
        </div>
      </main>
    );
  }

  // Honor ?engagement=, else default to the user's selected repo (matching
  // prior behavior), else the first option that actually has a repo.
  const activeOption =
    repoOptions.find((o) => o.key === engagementParam) ??
    repoOptions.find((o) => o.repo && o.repo.fullName === connection.selectedRepo?.fullName) ??
    repoOptions.find((o) => o.repo) ??
    repoOptions[0];

  if (!activeOption.repo) {
    const repos = await fetchGithubRepos(connection.token);
    return (
      <main className="krowe-page krowe-blueprint-canvas">
        <div
          className="krowe-page-inner anim-fade-up"
          style={{ maxWidth: 1180, display: "flex", flexDirection: "column", gap: 20 }}
        >
          <RepoChips options={repoOptions} activeKey={activeOption.key} />
          <div className="rounded-lg border border-neutral-200 bg-white p-6" style={{ maxWidth: 560 }}>
            <h2 className="text-sm font-semibold text-neutral-900">Link a repository</h2>
            <p className="mt-1 text-sm text-neutral-500">
              {activeOption.label} doesn&apos;t have a repo yet. Link one to power its
              project view, commits, and branches.
            </p>
            <div className="mt-4">
              <RepoSelector engagementId={activeOption.key} initialRepos={repos} />
            </div>
          </div>
        </div>
      </main>
    );
  }

  const activeRepo = activeOption;
  const { owner, name, defaultBranch, fullName } = activeOption.repo;

  const [repoContext, branchGraph] = await Promise.all([
    buildRepoContext(connection.token, owner, name, defaultBranch),
    buildBranchGraph(connection.token, owner, name, defaultBranch),
  ]);

  // Prefer the engagement that owns the active repo; fall back to a full-name
  // match, then (for single-engagement accounts) the lone engagement.
  const engagement =
    activeRepo.engagement ??
    engagements.find((e) => e.github_repo_full_name === fullName) ??
    (engagements.length === 1 ? engagements[0] : null);

  if (!repoContext) {
    return (
      <main className="krowe-page krowe-blueprint-canvas">
        <div
          className="krowe-page-inner anim-fade-up"
          style={{ maxWidth: 1180, display: "flex", flexDirection: "column", gap: 20 }}
        >
          <RepoChips options={repoOptions} activeKey={activeRepo.key} />
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
        <RepoChips options={repoOptions} activeKey={activeRepo.key} />

        <ProjectHeader
          title={title}
          org={owner}
          repoName={name}
          tagline={repoContext.description}
          branch={defaultBranch}
          repoUrl={repoUrl}
          builderName={operatorName ? `for ${operatorName}` : profile.display_name}
          startedAt={engagement?.created_at ?? new Date().toISOString()}
          settingsHref="/b/github/settings"
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

function RepoChips({ options, activeKey }: { options: RepoOption[]; activeKey: string }) {
  if (options.length <= 1) return null;
  return (
    <div className="krowe-filter-row" style={{ marginBottom: -4 }}>
      {options.map((o) => (
        <Link
          key={o.key}
          href={`/b/github?engagement=${o.key}`}
          className={`krowe-filter-chip ${o.key === activeKey ? "active" : ""}`}
        >
          {o.label}
          <span className="count">{o.repo?.name ?? "no repo"}</span>
        </Link>
      ))}
    </div>
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
