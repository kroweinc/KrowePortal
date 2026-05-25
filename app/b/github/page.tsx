import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { getUserGithubConnection } from "@/lib/github/token";
import { buildRepoContext } from "@/lib/github/repo-context";
import { buildBranchGraph, type BranchGraph, type BranchNode } from "@/lib/github/branches";
import { getProjectProfile } from "@/lib/actions/generate-project-profile";
import { getBranchPurposes } from "@/lib/actions/get-branch-purposes";
import {
  AiOverviewCard,
  AiOverviewSkeleton,
  BranchesTreeWithPurposes,
  BranchesTreeSkeleton,
  BranchesUnavailable,
  FileTreeSnapshot,
  LanguagesBar,
  NotConnected,
  NoRepoSelected,
  ProfileHeader,
  ReadmePreview,
  RecentCommitsList,
  RepoFetchError,
} from "@/components/project-profile";

function flattenBranches(graph: BranchGraph) {
  const out: {
    name: string;
    tipShaFull: string;
    latestCommit: { message: string; date: string } | null;
  }[] = [];
  function walk(node: BranchNode) {
    out.push({
      name: node.name,
      tipShaFull: node.tipShaFull,
      latestCommit: node.latestCommit,
    });
    for (const child of node.children) walk(child);
  }
  walk(graph.root);
  return out;
}

export default async function ProjectProfilePage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") redirect("/o");

  const connection = await getUserGithubConnection(profile.id);

  if (!connection) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <NotConnected />
      </main>
    );
  }

  if (!connection.selectedRepo) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <NoRepoSelected />
      </main>
    );
  }

  const { owner, name, defaultBranch, fullName } = connection.selectedRepo;

  const [context, branchGraph] = await Promise.all([
    buildRepoContext(connection.token, owner, name, defaultBranch),
    buildBranchGraph(connection.token, owner, name, defaultBranch),
  ]);

  if (!context) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <RepoFetchError repoFullName={fullName} />
      </main>
    );
  }

  const toolContext = {
    token: connection.token,
    owner,
    repo: name,
    ref: defaultBranch,
  };

  const profilePromise = getProjectProfile(context, toolContext);
  const purposesPromise = branchGraph
    ? getBranchPurposes(fullName, flattenBranches(branchGraph))
    : Promise.resolve({});

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-10">
      <ProfileHeader context={context} />

      <Suspense fallback={<AiOverviewSkeleton />}>
        <AiOverviewCard profilePromise={profilePromise} />
      </Suspense>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RecentCommitsList context={context} />
        <LanguagesBar context={context} profilePromise={profilePromise} />
      </div>

      {branchGraph ? (
        <Suspense fallback={<BranchesTreeSkeleton />}>
          <BranchesTreeWithPurposes
            graph={branchGraph}
            purposesPromise={purposesPromise}
            owner={owner}
            repo={name}
          />
        </Suspense>
      ) : (
        <BranchesUnavailable />
      )}

      <FileTreeSnapshot context={context} />

      <ReadmePreview context={context} />
    </main>
  );
}
