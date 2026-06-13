"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RepoPickerDialog } from "./repo-picker-dialog";
import { syncGithubProjects } from "@/lib/actions/builder-profile";
import type { BuilderProfileProject } from "@/lib/types";

interface GithubShowcaseEditorProps {
  githubConnected: boolean;
  githubUsername: string | null;
  githubProjects: BuilderProfileProject[];
  githubSyncedAt: string | null;
}

function formatSyncTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function GithubShowcaseEditor({
  githubConnected,
  githubUsername,
  githubProjects,
  githubSyncedAt,
}: GithubShowcaseEditorProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function sync() {
    startTransition(async () => {
      const result = await syncGithubProjects();
      if (result.error) {
        toast.error(result.error);
        if (!result.success) return;
      } else {
        toast.success(`Synced ${result.synced ?? 0} repo${result.synced === 1 ? "" : "s"} from GitHub`);
      }
      router.refresh();
    });
  }

  if (!githubConnected) {
    return (
      <div className="rounded-md border border-dashed border-neutral-200 px-4 py-6 text-center">
        <p className="text-sm text-neutral-500">
          Connect GitHub to feature verified projects with real commit and language stats.
        </p>
        <Link
          href="/b/settings"
          className="mt-2 inline-block text-sm text-neutral-700 underline underline-offset-2 hover:text-neutral-900"
        >
          Connect GitHub in Settings
        </Link>
      </div>
    );
  }

  const featuredIds = githubProjects
    .map((p) => p.github_repo_id)
    .filter((id): id is number => id !== null);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="text-xs text-neutral-500">
        Connected as <span className="font-medium text-neutral-700">{githubUsername}</span>
        {githubSyncedAt && (
          <>
            {" "}
            <span className="text-neutral-300">·</span> Last synced {formatSyncTime(githubSyncedAt)}
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        {githubProjects.length > 0 && (
          <Button variant="outline" size="sm" onClick={sync} disabled={isPending}>
            <RefreshCw className={"h-3.5 w-3.5" + (isPending ? " animate-spin" : "")} />
            {isPending ? "Syncing…" : "Sync from GitHub"}
          </Button>
        )}
        <RepoPickerDialog featuredRepoIds={featuredIds} />
      </div>
    </div>
  );
}
