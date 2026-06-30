import Link from "next/link";
import { Github, GitBranch, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

function EmptyShell({
  icon,
  title,
  message,
  ctaHref,
  ctaLabel,
}: {
  icon: React.ReactNode;
  title: string;
  message: string;
  ctaHref: string;
  ctaLabel: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="rounded-full bg-neutral-100 p-3 text-neutral-500">{icon}</div>
        <h2 className="text-lg font-semibold text-neutral-900">{title}</h2>
        <p className="max-w-md text-sm text-neutral-500">{message}</p>
        <Link
          href={ctaHref}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          {ctaLabel}
        </Link>
      </CardContent>
    </Card>
  );
}

export function NotConnected() {
  return (
    <EmptyShell
      icon={<Github className="h-6 w-6" aria-hidden />}
      title="Connect GitHub to see your project"
      message="Link your GitHub account so the project profile can pull in your repo's overview, recent commits, and structure."
      ctaHref="/b/settings/github"
      ctaLabel="Go to GitHub settings"
    />
  );
}

export function NoRepoSelected() {
  return (
    <EmptyShell
      icon={<GitBranch className="h-6 w-6" aria-hidden />}
      title="Pick a default repository"
      message="You're connected to GitHub, but haven't selected a repo yet. Choose one and the profile will appear here."
      ctaHref="/b/settings/github"
      ctaLabel="Select a repository"
    />
  );
}

export function RepoFetchError({ repoFullName }: { repoFullName?: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="rounded-full bg-red-50 p-3 text-red-600">
          <AlertTriangle className="h-6 w-6" aria-hidden />
        </div>
        <h2 className="text-lg font-semibold text-neutral-900">Couldn&apos;t load that repo</h2>
        <p className="max-w-md text-sm text-neutral-500">
          {repoFullName ? (
            <>
              We couldn&apos;t fetch <span className="font-mono">{repoFullName}</span> from GitHub.
              It may have been renamed, deleted, or made private.
            </>
          ) : (
            <>We couldn&apos;t fetch the selected repo from GitHub.</>
          )}
        </p>
        <Link
          href="/b/settings/github"
          className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:border-neutral-300 hover:text-neutral-900"
        >
          Pick a different repo
        </Link>
      </CardContent>
    </Card>
  );
}
