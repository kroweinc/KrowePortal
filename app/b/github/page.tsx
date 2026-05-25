import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { getUserGithubConnection } from "@/lib/github/token";
import { buildRepoContext } from "@/lib/github/repo-context";
import { getProjectProfile } from "@/lib/actions/generate-project-profile";
import {
  AiOverviewCard,
  AiOverviewSkeleton,
  FileTreeSnapshot,
  LanguagesBar,
  NotConnected,
  NoRepoSelected,
  ProfileHeader,
  ReadmePreview,
  RecentCommitsList,
  RepoFetchError,
} from "@/components/project-profile";

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
  const context = await buildRepoContext(connection.token, owner, name, defaultBranch);

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

      <FileTreeSnapshot context={context} />

      <ReadmePreview context={context} />
    </main>
  );
}
