"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, GitCommitHorizontal, Globe, Lock, Pencil, Star, Trash2 } from "lucide-react";
import { ManualProjectForm } from "./manual-project-form";
import { VerifiedBadge } from "./verified-badge";
import { LanguageBar } from "./language-bar";
import { TechBadge } from "./tech-badge";
import {
  deleteProfileProject,
  reorderProfileProjects,
  updateProfileProject,
} from "@/lib/actions/builder-profile";
import { safeExternalHref } from "@/lib/project/business-context";
import type { BuilderProfileProject } from "@/lib/types";

export function ProjectList({ projects }: { projects: BuilderProfileProject[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function move(index: number, dir: -1 | 1) {
    const next = [...projects];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    startTransition(async () => {
      const result = await reorderProfileProjects(next.map((p) => p.id));
      if (result.error) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  // Manual projects edit their live link in the edit dialog; GitHub rows are
  // otherwise read-only, so this is their only affordance for setting one.
  function setLiveLink(project: BuilderProfileProject) {
    const value = prompt(
      "Live demo URL — where viewers can interact with the work (leave empty to remove):",
      project.live_url ?? ""
    );
    if (value === null) return;
    startTransition(async () => {
      const result = await updateProfileProject(project.id, { liveUrl: value.trim() });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(value.trim() ? "Live link saved." : "Live link removed.");
      router.refresh();
    });
  }

  function remove(project: BuilderProfileProject) {
    const note =
      project.source === "github"
        ? "Remove this repo from your profile? You can re-add it from the picker."
        : "Delete this project? This cannot be undone.";
    if (!confirm(note)) return;
    startTransition(async () => {
      const result = await deleteProfileProject(project.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  if (projects.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-neutral-200 px-4 py-6 text-center text-sm text-neutral-400">
        No projects yet. Feature repos from GitHub or add one by hand.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {projects.map((project, index) => (
        <li
          key={project.id}
          className="rounded-md border border-neutral-200 bg-white p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {project.url ? (
                  <a
                    href={safeExternalHref(project.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate text-sm font-semibold text-neutral-900 hover:underline"
                  >
                    {project.name}
                  </a>
                ) : (
                  <span className="truncate text-sm font-semibold text-neutral-900">
                    {project.name}
                  </span>
                )}
                {project.source === "github" && <VerifiedBadge />}
                {project.github_is_private && (
                  <span
                    className="inline-flex items-center gap-1 text-[11px] text-neutral-400"
                    title="Private repository"
                  >
                    <Lock className="h-3 w-3" /> private
                  </span>
                )}
                {project.live_url && (
                  <a
                    href={safeExternalHref(project.live_url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-neutral-600 underline underline-offset-2 hover:text-neutral-900"
                  >
                    <Globe className="h-3 w-3" /> Live ↗
                  </a>
                )}
              </div>
              {project.description && (
                <p className="mt-1 text-xs text-neutral-500">{project.description}</p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500">
                {project.commit_count !== null && project.source === "github" && (
                  <span className="inline-flex items-center gap-1">
                    <GitCommitHorizontal className="h-3 w-3" />
                    {project.commit_count.toLocaleString()} commits
                  </span>
                )}
                {project.stars !== null && project.stars > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <Star className="h-3 w-3" /> {project.stars.toLocaleString()}
                  </span>
                )}
                {project.tech.map((t) => (
                  <TechBadge key={t} tech={t} />
                ))}
              </div>
              {project.languages && project.languages.length > 0 && (
                <div className="mt-3">
                  <LanguageBar languages={project.languages} />
                </div>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={isPending || index === 0}
                className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-30"
                aria-label="Move up"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={isPending || index === projects.length - 1}
                className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-30"
                aria-label="Move down"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              {project.source === "github" && (
                <button
                  type="button"
                  onClick={() => setLiveLink(project)}
                  disabled={isPending}
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                  aria-label="Set live demo link"
                  title="Set live demo link"
                >
                  <Globe className="h-3.5 w-3.5" />
                </button>
              )}
              {project.source === "manual" && (
                <ManualProjectForm
                  project={project}
                  trigger={
                    <button
                      type="button"
                      className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                      aria-label="Edit project"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  }
                />
              )}
              <button
                type="button"
                onClick={() => remove(project)}
                disabled={isPending}
                className="rounded p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600"
                aria-label="Remove project"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
