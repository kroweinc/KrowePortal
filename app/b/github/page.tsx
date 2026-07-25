import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { getUserGithubConnection } from "@/lib/github/token";
import { buildRepoContext } from "@/lib/github/repo-context";
import { buildBranchGraph } from "@/lib/github/branches";
import {
  fetchCommitChecks,
  fetchRepoInsights,
  type CommitCheck,
} from "@/lib/github/repo-insights";
import { getCommitTaskLinks, type CommitTaskLink } from "@/lib/actions/commit-task-links";
import {
  getProjectProfile,
  type ProjectProfile,
} from "@/lib/actions/generate-project-profile";
import { getMyEngagements } from "@/lib/actions/invitations";
import {
  OverviewSection,
  OverviewSectionSkeleton,
  RepoTopline,
  ToolkitSection,
  ToolkitSectionSkeleton,
  UpdatesSection,
  type ToolkitStats,
} from "@/components/repo-page";
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

/** Commits listed under Updates — also caps the per-commit check-run fan-out. */
const UPDATES_LIMIT = 12;

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
      <main className="krowe-page">
        <div className="krowe-repo-inner anim-fade-up">
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
      <main className="krowe-page">
        <div className="krowe-repo-inner anim-fade-up">
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
      <main className="krowe-page">
        <div className="krowe-repo-inner anim-fade-up">
          <RepoChips options={repoOptions} activeKey={activeOption.key} />
          <div className="krowe-repo-card" style={{ maxWidth: 520, padding: "16px 18px" }}>
            <h2 className="krowe-repo-card-title">Link a repository</h2>
            <p style={{ marginTop: 6, fontSize: 12.5, color: "var(--muted-foreground)" }}>
              {activeOption.label} doesn&apos;t have a repo yet. Link one to power its
              project view, commits, and branches.
            </p>
            <div style={{ marginTop: 14 }}>
              <RepoSelector engagementId={activeOption.key} initialRepos={repos} />
            </div>
          </div>
        </div>
      </main>
    );
  }

  const activeRepo = activeOption;
  const { owner, name, defaultBranch, fullName } = activeOption.repo;

  const [repoContext, branchGraph, insights] = await Promise.all([
    buildRepoContext(connection.token, owner, name, defaultBranch),
    buildBranchGraph(connection.token, owner, name, defaultBranch),
    fetchRepoInsights(connection.token, owner, name, defaultBranch),
  ]);

  // Prefer the engagement that owns the active repo; fall back to a full-name
  // match, then (for single-engagement accounts) the lone engagement.
  const engagement =
    activeRepo.engagement ??
    engagements.find((e) => e.github_repo_full_name === fullName) ??
    (engagements.length === 1 ? engagements[0] : null);

  const repoUrl = `https://github.com/${owner}/${name}`;

  if (!repoContext) {
    return (
      <main className="krowe-page">
        <div className="krowe-repo-inner anim-fade-up">
          <RepoChips options={repoOptions} activeKey={activeRepo.key} />
          <RepoFetchError repoFullName={fullName} />
        </div>
      </main>
    );
  }

  const profilePromise: Promise<ProjectProfile | null> = getProjectProfile(repoContext, {
    token: connection.token,
    owner,
    repo: name,
    ref: defaultBranch,
  });

  // Prefer the two-week window for the Updates list so it groups across days;
  // a repo that's been quiet longer than that falls back to RepoContext's
  // last-8, which isn't time-bounded.
  const timeline = (
    insights.commits.length > 0 ? insights.commits : repoContext.recentCommits
  ).slice(0, UPDATES_LIMIT);

  const shas = timeline.map((c) => c.sha);
  // CI verdicts and task links only decorate the commit rows, so neither is
  // allowed to take the page down with it.
  const [checksResult, linksResult] = await Promise.allSettled([
    fetchCommitChecks(connection.token, owner, name, shas),
    getCommitTaskLinks(profile.id, fullName, shas),
  ]);
  const checks: Map<string, CommitCheck> =
    checksResult.status === "fulfilled" ? checksResult.value : new Map();
  const links: Map<string, CommitTaskLink> =
    linksResult.status === "fulfilled" ? linksResult.value : new Map();

  const stats: ToolkitStats = {
    commits2w: insights.activity.reduce((sum, d) => sum + d.count, 0),
    branches: branchGraph ? branchGraph.root.children.length + 1 : 0,
    contributors: new Set(
      (insights.commits.length > 0 ? insights.commits : repoContext.recentCommits)
        .map((c) => c.author?.login ?? c.author?.name ?? null)
        .filter((v): v is string => Boolean(v))
    ).size,
    lastCommitIso: timeline[0]?.date ?? repoContext.recentCommits[0]?.date ?? null,
    social: insights.stats,
  };

  // Title: prefer engagement title (the operator's chosen name) when paired,
  // otherwise fall back to the repo name.
  const title = engagement?.title ?? name;

  return (
    <>
      <RepoTopline title={title} repoUrl={repoUrl} />

      <main className="krowe-page">
        <div className="krowe-repo-inner anim-fade-up">
          <RepoChips options={repoOptions} activeKey={activeRepo.key} />

          <Suspense fallback={<OverviewSectionSkeleton />}>
            <OverviewSection profilePromise={profilePromise} />
          </Suspense>

          {/* Layers read better with the AI profile's service list, so this
              streams alongside Overview rather than blocking the shell. */}
          <Suspense fallback={<ToolkitSectionSkeleton />}>
            <AsyncToolkitSection
              stats={stats}
              languages={repoContext.languages}
              layersPromise={profilePromise.then((p) => deriveArchLayers(repoContext, p))}
            />
          </Suspense>

          <UpdatesSection
            commits={timeline}
            activity={insights.activity}
            repoUrl={repoUrl}
            checks={checks}
            links={links}
          />

          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <Link href="/b" className="dashed-link" style={{ fontSize: 13.5, fontWeight: 500 }}>
              See your build board
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}

async function AsyncToolkitSection({
  stats,
  languages,
  layersPromise,
}: {
  stats: ToolkitStats;
  languages: RepoContext["languages"];
  layersPromise: Promise<ReturnType<typeof deriveArchLayers>>;
}) {
  const layers = await layersPromise;
  return <ToolkitSection stats={stats} layers={layers} languages={languages} />;
}

function RepoChips({ options, activeKey }: { options: RepoOption[]; activeKey: string }) {
  if (options.length <= 1) return null;
  return (
    <div className="krowe-filter-row">
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
