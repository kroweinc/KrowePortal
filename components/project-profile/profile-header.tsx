import Link from "next/link";
import { Github, Settings, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { RepoContext } from "@/lib/github/types";
import { RefreshButton } from "./refresh-button";

interface ProfileHeaderProps {
  context: RepoContext;
}

export function ProfileHeader({ context }: ProfileHeaderProps) {
  const githubUrl = `https://github.com/${context.owner}/${context.repo}`;

  return (
    <header className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm text-neutral-400">
            <Github className="h-4 w-4" aria-hidden />
            <span>{context.owner}</span>
            <span>/</span>
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-neutral-900 truncate">
            {context.repo}
          </h1>
          {context.description && (
            <p className="mt-2 text-sm text-neutral-600">{context.description}</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge variant="secondary">branch: {context.defaultBranch}</Badge>
            {context.degraded.length > 0 && (
              <Badge variant="medium">
                partial data: {context.degraded.join(", ")}
              </Badge>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <RefreshButton />
          <a
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:border-neutral-300 hover:text-neutral-900"
          >
            View on GitHub
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
          <Link
            href="/b/settings/github"
            className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:border-neutral-300 hover:text-neutral-900"
          >
            <Settings className="h-3.5 w-3.5" aria-hidden />
            Settings
          </Link>
        </div>
      </div>
    </header>
  );
}
