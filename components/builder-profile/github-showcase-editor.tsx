"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, RefreshCw } from "lucide-react";
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
      <div className="ss-empty">
        <p>Connect GitHub to feature verified projects with real commit and language stats.</p>
        <Link href="/b/settings" className="ss-btn">
          <Plus /> Connect GitHub
        </Link>
      </div>
    );
  }

  const featuredIds = githubProjects
    .map((p) => p.github_repo_id)
    .filter((id): id is number => id !== null);

  return (
    <div className="ss-ghrow">
      <div className="who">
        <span>
          Connected to <b>{githubUsername}</b>
        </span>
        {githubSyncedAt && (
          <>
            <span className="ss-rule" aria-hidden />
            <span>Last synced {formatSyncTime(githubSyncedAt)}</span>
          </>
        )}
      </div>
      <div className="acts">
        {githubProjects.length > 0 && (
          <button type="button" className="ss-btn" onClick={sync} disabled={isPending}>
            <RefreshCw className={isPending ? "animate-spin" : undefined} />
            {isPending ? "Syncing\u2026" : "Sync from GitHub"}
          </button>
        )}
        <RepoPickerDialog featuredRepoIds={featuredIds} />
      </div>
    </div>
  );
}
