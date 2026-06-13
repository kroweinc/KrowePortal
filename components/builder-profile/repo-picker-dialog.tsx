"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Lock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { setFeaturedRepos } from "@/lib/actions/builder-profile";
import type { GitHubRepo } from "@/lib/types";

const MAX_FEATURED = 8;

interface RepoPickerDialogProps {
  featuredRepoIds: number[];
  trigger?: React.ReactNode;
}

export function RepoPickerDialog({ featuredRepoIds, trigger }: RepoPickerDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set(featuredRepoIds));
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setLoadError(null);
    fetch("/api/github/repos")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setLoadError(data.error);
        setRepos(Array.isArray(data.repos) ? data.repos : []);
      })
      .catch(() => setLoadError("Could not load repositories."))
      .finally(() => setLoading(false));
  }, [open]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) setSelected(new Set(featuredRepoIds));
  }

  function toggle(repoId: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(repoId)) {
        next.delete(repoId);
      } else {
        if (next.size >= MAX_FEATURED) {
          toast.error(`You can feature up to ${MAX_FEATURED} repositories.`);
          return prev;
        }
        next.add(repoId);
      }
      return next;
    });
  }

  const hasPrivateSelected = repos.some((r) => r.private && selected.has(r.id));

  function save() {
    const picked = repos
      .filter((r) => selected.has(r.id))
      .map((r) => ({ repoId: r.id, fullName: r.full_name, isPrivate: r.private }));
    startTransition(async () => {
      const result = await setFeaturedRepos(picked);
      if (result.error) {
        toast.error(result.error);
        if (!result.success) return;
      } else {
        toast.success("Featured repos synced from GitHub");
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? <Button variant="outline" size="sm">Choose repos</Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Feature repositories</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          <p className="text-xs text-neutral-500">
            Pick up to {MAX_FEATURED} repos to showcase. Stats are pulled from GitHub and shown
            with a verified badge.
          </p>

          {loading ? (
            <p className="py-6 text-center text-sm text-neutral-400">Loading repositories…</p>
          ) : loadError ? (
            <p className="py-6 text-center text-sm text-red-600">{loadError}</p>
          ) : repos.length === 0 ? (
            <p className="py-6 text-center text-sm text-neutral-400">No repositories found.</p>
          ) : (
            <div className="max-h-80 space-y-1 overflow-y-auto pr-1">
              {repos.map((repo) => (
                <label
                  key={repo.id}
                  className="flex cursor-pointer items-start gap-3 rounded-md border border-transparent px-2 py-2 hover:bg-neutral-50"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(repo.id)}
                    onChange={() => toggle(repo.id)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm text-neutral-900">
                      <span className="truncate">{repo.full_name}</span>
                      {repo.private && <Lock className="h-3 w-3 shrink-0 text-neutral-400" />}
                    </span>
                    {repo.description && (
                      <span className="block truncate text-xs text-neutral-500">
                        {repo.description}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}

          {hasPrivateSelected && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Featuring a private repo publishes its name, description, and stats on your public
              profile. Code is never shown.
            </p>
          )}

          <Button onClick={save} disabled={isPending || loading} className="w-full">
            {isPending ? "Syncing from GitHub…" : `Save (${selected.size}/${MAX_FEATURED})`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
