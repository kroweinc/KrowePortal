"use client";

import { useEffect, useState, useTransition } from "react";
import { GitCommit, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { unlinkTaskCommit } from "@/lib/actions/task-commits";

export type LinkedCommit = {
  id: string;
  repo_full_name: string;
  commit_sha: string;
  commit_url: string;
  commit_message: string | null;
  commit_author_name: string | null;
  commit_author_login: string | null;
  commit_committed_at: string | null;
  linked_at: string;
  linked_by: string;
};

function firstLine(message: string | null): string {
  const line = ((message ?? "")).split("\n")[0];
  return line.length > 100 ? `${line.slice(0, 97)}…` : line;
}

function relTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso).getTime();
  const diffMin = Math.floor((Date.now() - d) / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `${h}h ago`;
  const dys = Math.floor(h / 24);
  if (dys < 7) return `${dys}d ago`;
  return new Date(iso).toLocaleDateString();
}

interface Props {
  taskId: string;
  canUnlink?: boolean;
}

export function TaskCommits({ taskId, canUnlink = false }: Props) {
  const [commits, setCommits] = useState<LinkedCommit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    setCommits(null);
    setError(null);
    fetch(`/api/task-commits?taskId=${encodeURIComponent(taskId)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        setCommits(Array.isArray(data) ? (data as LinkedCommit[]) : []);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load commits");
        setCommits([]);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  function handleUnlink(id: string) {
    startTransition(async () => {
      const result = await unlinkTaskCommit(id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setCommits((prev) => (prev ? prev.filter((c) => c.id !== id) : prev));
      router.refresh();
    });
  }

  if (commits === null) return null;
  if (error) return null;
  if (commits.length === 0) return null;

  return (
    <ul className="krowe-commit-list">
      {commits.map((c) => (
        <li key={c.id} className="krowe-commit-row">
          <a
            href={c.commit_url}
            target="_blank"
            rel="noopener noreferrer"
            className="krowe-commit-link"
          >
            <GitCommit className="h-3.5 w-3.5 shrink-0" />
            <span className="krowe-commit-sha">{c.commit_sha.slice(0, 7)}</span>
            <span className="krowe-commit-msg">{firstLine(c.commit_message)}</span>
            <span className="krowe-commit-meta">
              {c.commit_author_name ?? c.commit_author_login ?? ""}
              {c.commit_committed_at && (
                <>
                  {(c.commit_author_name || c.commit_author_login) ? " · " : ""}
                  {relTime(c.commit_committed_at)}
                </>
              )}
            </span>
          </a>
          {canUnlink && (
            <button
              type="button"
              onClick={() => handleUnlink(c.id)}
              disabled={isPending}
              className="krowe-commit-unlink"
              aria-label={`Unlink commit ${c.commit_sha.slice(0, 7)}`}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
